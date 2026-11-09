from collections.abc import Sequence
from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import (
    Category,
    Ledger,
    LedgerMember,
    LedgerRole,
    Tag,
    Transaction,
    TransactionItem,
    TransactionTag,
)
from app.models.category import TransactionType
from app.schemas.tag import TagPublic
from app.schemas.transaction import (
    BatchCategorizeResponse,
    BulkDeleteResponse,
    TransactionCreate,
    TransactionPublic,
    TransactionUpdate,
)
from app.schemas.transaction_item import TransactionItemCreate, TransactionItemPublic
from app.services.recurring import materialize_due_for_ledger

router = APIRouter(prefix="/ledgers/{ledger_id}/transactions", tags=["transactions"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)


async def _validate_category(
    db, ledger_id: UUID, category_id: UUID | None, expected_type: TransactionType | None
) -> None:
    if category_id is None:
        return
    category = await db.get(Category, category_id)
    if category is None or category.ledger_id != ledger_id:
        raise HTTPException(status_code=400, detail="Invalid category for this ledger")
    if expected_type is not None and category.type != expected_type:
        raise HTTPException(status_code=400, detail="Category type does not match transaction type")


async def _resolve_tags(db: AsyncSession, ledger_id: UUID, tag_ids: list[UUID]) -> list[Tag]:
    """Validate that every tag id belongs to this ledger and return the Tag rows."""
    if not tag_ids:
        return []
    unique_ids = list(dict.fromkeys(tag_ids))
    tags = list(
        (
            await db.exec(
                select(Tag).where(Tag.ledger_id == ledger_id, Tag.id.in_(unique_ids))
            )
        ).all()
    )
    if len(tags) != len(unique_ids):
        raise HTTPException(status_code=400, detail="One or more tags are invalid for this ledger")
    return tags


async def _set_transaction_tags(
    db: AsyncSession, transaction_id: UUID, tag_ids: list[UUID]
) -> None:
    """Replace the tag links for a transaction with the given set."""
    existing = list(
        (
            await db.exec(
                select(TransactionTag).where(TransactionTag.transaction_id == transaction_id)
            )
        ).all()
    )
    for link in existing:
        await db.delete(link)
    for tag_id in dict.fromkeys(tag_ids):
        db.add(TransactionTag(transaction_id=transaction_id, tag_id=tag_id))


async def _tags_by_transaction(
    db: AsyncSession, transaction_ids: Sequence[UUID]
) -> dict[UUID, list[Tag]]:
    """Fetch tags for a batch of transactions in one round-trip."""
    if not transaction_ids:
        return {}
    stmt = (
        select(TransactionTag.transaction_id, Tag)
        .join(Tag, Tag.id == TransactionTag.tag_id)
        .where(TransactionTag.transaction_id.in_(list(transaction_ids)))
        .order_by(Tag.name)
    )
    result: dict[UUID, list[Tag]] = {}
    for txn_id, tag in (await db.exec(stmt)).all():
        result.setdefault(txn_id, []).append(tag)
    return result


async def _items_by_transaction(
    db: AsyncSession, transaction_ids: Sequence[UUID]
) -> dict[UUID, list[TransactionItem]]:
    """Fetch items for a batch of transactions in one round-trip."""
    if not transaction_ids:
        return {}
    stmt = (
        select(TransactionItem)
        .where(TransactionItem.transaction_id.in_(list(transaction_ids)))
        .order_by(TransactionItem.created_at.asc())
    )
    result: dict[UUID, list[TransactionItem]] = {}
    for item in (await db.exec(stmt)).all():
        result.setdefault(item.transaction_id, []).append(item)
    return result


async def _set_transaction_items(
    db: AsyncSession,
    transaction_id: UUID,
    ledger_id: UUID,
    items: list[TransactionItemCreate],
) -> list[TransactionItem]:
    """Replace line items for a transaction."""
    existing = list(
        (
            await db.exec(
                select(TransactionItem).where(TransactionItem.transaction_id == transaction_id)
            )
        ).all()
    )
    for item in existing:
        await db.delete(item)
    created: list[TransactionItem] = []
    for it in items:
        new_item = TransactionItem(
            transaction_id=transaction_id,
            ledger_id=ledger_id,
            name=it.name.strip(),
            item_group=it.item_group.strip() if it.item_group and it.item_group.strip() else None,
            quantity=it.quantity,
            unit_price=it.unit_price,
            total_price=it.total_price,
            memo=it.memo.strip() if it.memo and it.memo.strip() else None,
        )
        db.add(new_item)
        created.append(new_item)
    return created


def _to_public(
    txn: Transaction,
    tags: list[Tag],
    items: list[TransactionItem] | None = None,
) -> TransactionPublic:
    return TransactionPublic(
        id=txn.id,
        ledger_id=txn.ledger_id,
        category_id=txn.category_id,
        created_by_id=txn.created_by_id,
        type=txn.type,
        amount=txn.amount,
        currency=txn.currency,
        transaction_date=txn.transaction_date,
        payee=txn.payee,
        memo=txn.memo,
        tags=[TagPublic.model_validate(t) for t in tags],
        items=[TransactionItemPublic.model_validate(it) for it in (items or [])],
        created_at=txn.created_at,
    )


@router.get("", response_model=list[TransactionPublic])
async def list_transactions(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    type: TransactionType | None = None,
    category_id: UUID | None = None,
    uncategorized: bool | None = Query(default=None, description="Filter for transactions with no category"),
    tag_id: UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    q: str | None = Query(default=None, max_length=200, description="Search in payee/memo/item name"),
    limit: int = Query(default=100, le=500),
    offset: int = 0,
) -> list[TransactionPublic]:
    ledger, _ = membership
    if await materialize_due_for_ledger(db, ledger.id) > 0:
        await db.commit()
    stmt = select(Transaction).where(Transaction.ledger_id == ledger.id)
    if type is not None:
        stmt = stmt.where(Transaction.type == type)
    if uncategorized is True:
        stmt = stmt.where(Transaction.category_id.is_(None))
    elif category_id is not None:
        stmt = stmt.where(Transaction.category_id == category_id)
    if tag_id is not None:
        stmt = stmt.where(
            Transaction.id.in_(
                select(TransactionTag.transaction_id).where(TransactionTag.tag_id == tag_id)
            )
        )
    if start_date is not None:
        stmt = stmt.where(Transaction.transaction_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(Transaction.transaction_date <= end_date)
    if q:
        pattern = f"%{q.strip()}%"
        matching_item_txn_ids = select(TransactionItem.transaction_id).where(
            (TransactionItem.ledger_id == ledger.id)
            & ((TransactionItem.name.ilike(pattern)) | (TransactionItem.item_group.ilike(pattern)))
        )
        stmt = stmt.where(
            (Transaction.payee.ilike(pattern))
            | (Transaction.memo.ilike(pattern))
            | (Transaction.id.in_(matching_item_txn_ids))
        )
    stmt = stmt.order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
    stmt = stmt.offset(offset).limit(limit)
    txns = list((await db.exec(stmt)).all())

    txn_ids = [t.id for t in txns]
    tag_map = await _tags_by_transaction(db, txn_ids)
    item_map = await _items_by_transaction(db, txn_ids)
    return [_to_public(t, tag_map.get(t.id, []), item_map.get(t.id, [])) for t in txns]


@router.post("", response_model=TransactionPublic, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> TransactionPublic:
    ledger, member = membership
    await _validate_category(db, ledger.id, payload.category_id, payload.type)
    tags = await _resolve_tags(db, ledger.id, payload.tag_ids)

    data = payload.model_dump(exclude={"tag_ids", "items"})
    txn = Transaction(ledger_id=ledger.id, created_by_id=member.user_id, **data)
    db.add(txn)
    await db.flush()
    await _set_transaction_tags(db, txn.id, [t.id for t in tags])

    items: list[TransactionItem] = []
    if payload.items:
        items = await _set_transaction_items(db, txn.id, ledger.id, payload.items)

    await db.commit()
    await db.refresh(txn)
    return _to_public(txn, tags, items)


@router.delete("/bulk", response_model=BulkDeleteResponse)
async def bulk_delete_transactions(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
    uncategorized_only: bool = Query(default=False, description="Delete only uncategorized transactions"),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    created_after: datetime | None = Query(default=None, description="Delete only transactions created after this timestamp"),
) -> BulkDeleteResponse:
    ledger, _ = membership
    stmt = select(Transaction).where(Transaction.ledger_id == ledger.id)
    if uncategorized_only:
        stmt = stmt.where(Transaction.category_id.is_(None))
    if created_after is not None:
        stmt = stmt.where(Transaction.created_at >= created_after)
    if start_date is not None:
        stmt = stmt.where(Transaction.transaction_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(Transaction.transaction_date <= end_date)

    txns = list((await db.exec(stmt)).all())
    count = len(txns)
    if count == 0:
        return BulkDeleteResponse(deleted_count=0, message="삭제할 거래내역이 없습니다.")

    txn_ids = [t.id for t in txns]

    # Delete related tags & items
    for txn_id in txn_ids:
        tag_links = list(
            (await db.exec(select(TransactionTag).where(TransactionTag.transaction_id == txn_id))).all()
        )
        for link in tag_links:
            await db.delete(link)
        items = list(
            (await db.exec(select(TransactionItem).where(TransactionItem.transaction_id == txn_id))).all()
        )
        for it in items:
            await db.delete(it)

    for t in txns:
        await db.delete(t)

    await db.commit()
    msg = f"총 {count}건의 거래내역이 성공적으로 삭제되었습니다."
    return BulkDeleteResponse(deleted_count=count, message=msg)


@router.post("/batch-categorize", response_model=BatchCategorizeResponse)
async def batch_auto_categorize_transactions(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
    force_all: bool = Query(default=False, description="Re-evaluate all transactions even if already categorized"),
) -> BatchCategorizeResponse:
    ledger, _ = membership

    categories = list((await db.exec(select(Category).where(Category.ledger_id == ledger.id))).all())
    if not categories:
        return BatchCategorizeResponse(
            total_processed=0,
            categorized_count=0,
            rules_count=0,
            ai_count=0,
            remaining_count=0,
            message="가계부에 등록된 카테고리가 없습니다.",
        )

    stmt = select(Transaction).where(Transaction.ledger_id == ledger.id)
    if not force_all:
        stmt = stmt.where(Transaction.category_id.is_(None))

    txns = list((await db.exec(stmt)).all())
    total_processed = len(txns)
    if total_processed == 0:
        return BatchCategorizeResponse(
            total_processed=0,
            categorized_count=0,
            rules_count=0,
            ai_count=0,
            remaining_count=0,
            message="분류할 대상 거래가 없습니다.",
        )

    rules_count = 0
    ai_count = 0
    from app.services.ai import is_ai_enabled, suggest_categories_batch
    from app.services.statement_parser import _guess_category_by_rules

    # Phase 1: High-speed rule-based classification (all in-memory regex/substring, < 0.05s)
    remaining_txns: list[Transaction] = []
    for txn in txns:
        corpus = f"{txn.payee or ''} {txn.memo or ''}".strip()
        txn_type_str = txn.type.value if hasattr(txn.type, "value") else str(txn.type)
        cat_id, cat_name = _guess_category_by_rules(corpus, categories, txn_type=txn_type_str)
        if cat_id:
            txn.category_id = cat_id
            rules_count += 1
            db.add(txn)
        else:
            remaining_txns.append(txn)

    # Immediately commit rule-based classifications so they are never lost even if network issues occur
    if rules_count > 0:
        await db.commit()

    # Phase 2: Batch AI classification with Gemini (chunks of 40 to ensure response in < 3s)
    if is_ai_enabled() and remaining_txns:
        ai_candidates = [t for t in remaining_txns if t.payee or t.memo]
        chunk_size = 40
        # Process up to 3 chunks (120 items) per invocation to guarantee fast response
        for i in range(0, min(len(ai_candidates), 120), chunk_size):
            chunk = ai_candidates[i : i + chunk_size]
            payload = [
                {
                    "id": str(t.id),
                    "type": t.type.value if hasattr(t.type, "value") else str(t.type),
                    "payee": t.payee,
                    "memo": t.memo,
                }
                for t in chunk
            ]
            matched_map = suggest_categories_batch(payload, categories)
            chunk_updated = False
            for t in chunk:
                tid_str = str(t.id)
                if tid_str in matched_map:
                    t.category_id = matched_map[tid_str]
                    ai_count += 1
                    db.add(t)
                    chunk_updated = True
            if chunk_updated:
                await db.commit()
    categorized_count = rules_count + ai_count
    remaining = total_processed - categorized_count

    msg = f"총 {total_processed}건 중 {categorized_count}건 분류 완료 (규칙: {rules_count}건, AI: {ai_count}건, 미분류: {remaining}건)"
    return BatchCategorizeResponse(
        total_processed=total_processed,
        categorized_count=categorized_count,
        rules_count=rules_count,
        ai_count=ai_count,
        remaining_count=remaining,
        message=msg,
    )


@router.get("/{transaction_id}", response_model=TransactionPublic)
async def get_transaction(
    transaction_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> TransactionPublic:
    ledger, _ = membership
    txn = await db.get(Transaction, transaction_id)
    if txn is None or txn.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Transaction not found")
    tag_map = await _tags_by_transaction(db, [txn.id])
    item_map = await _items_by_transaction(db, [txn.id])
    return _to_public(txn, tag_map.get(txn.id, []), item_map.get(txn.id, []))


@router.patch("/{transaction_id}", response_model=TransactionPublic)
async def update_transaction(
    transaction_id: UUID,
    payload: TransactionUpdate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> TransactionPublic:
    ledger, _ = membership
    txn = await db.get(Transaction, transaction_id)
    if txn is None or txn.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Transaction not found")

    data = payload.model_dump(exclude_unset=True)
    tag_ids = data.pop("tag_ids", None)
    items_data = data.pop("items", None)

    if "category_id" in data:
        await _validate_category(
            db, ledger.id, data["category_id"], data.get("type", txn.type)
        )

    for key, value in data.items():
        setattr(txn, key, value)
    db.add(txn)

    tags: list[Tag] | None = None
    if tag_ids is not None:
        tags = await _resolve_tags(db, ledger.id, tag_ids)
        await _set_transaction_tags(db, txn.id, [t.id for t in tags])

    items: list[TransactionItem] | None = None
    if items_data is not None:
        items = await _set_transaction_items(
            db, txn.id, ledger.id, [TransactionItemCreate.model_validate(it) for it in items_data]
        )

    await db.commit()
    await db.refresh(txn)

    if tags is None:
        tag_map = await _tags_by_transaction(db, [txn.id])
        tags = tag_map.get(txn.id, [])
    if items is None:
        item_map = await _items_by_transaction(db, [txn.id])
        items = item_map.get(txn.id, [])

    return _to_public(txn, tags, items)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> None:
    ledger, _ = membership
    txn = await db.get(Transaction, transaction_id)
    if txn is None or txn.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await db.delete(txn)
    await db.commit()

