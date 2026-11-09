from collections.abc import Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import (
    Category,
    DismissedTransaction,
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
    FixLegacyIncomesResponse,
    InternalTransferItem,
    InternalTransferListResponse,
    InternalTransferPair,
    InternalTransferResolveRequest,
    InternalTransferResolveResponse,
    TransactionCreate,
    TransactionPublic,
    TransactionUpdate,
)
from app.schemas.transaction_item import TransactionItemCreate, TransactionItemPublic
from app.services.ledger_cleanup import (
    find_internal_transfer_pairs,
    infer_types_from_balance,
    ledger_member_names,
    memo_balance,
)
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


def _transfer_item(t: Transaction) -> InternalTransferItem:
    return InternalTransferItem(
        id=t.id,
        type=t.type,
        amount=t.amount,
        transaction_date=t.transaction_date,
        payee=t.payee,
        memo=t.memo,
    )


async def _delete_as_dismissed(
    db: AsyncSession, txns: list[Transaction], reason: str = "internal_transfer"
) -> None:
    """Deletes transactions but keeps their fingerprint so a later statement re-import skips them."""
    for t in txns:
        db.add(
            DismissedTransaction(
                ledger_id=t.ledger_id,
                type=t.type,
                amount=t.amount,
                transaction_date=t.transaction_date,
                balance=memo_balance(t.memo),
                payee=t.payee,
                reason=reason,
            )
        )
        await db.delete(t)
    await db.commit()


async def _detect_transfer_pairs(db: AsyncSession, ledger_id: UUID) -> list[InternalTransferPair]:
    txns = list((await db.exec(select(Transaction).where(Transaction.ledger_id == ledger_id))).all())
    members = await ledger_member_names(db, ledger_id, txns)
    return [
        InternalTransferPair(
            pair_id=f"{p.expense.id}_{p.income.id}",
            date=p.expense.transaction_date,
            amount=p.expense.amount,
            description=f"{p.expense.payee or '출금'} ➔ {p.income.payee or '입금'}",
            expense_txn=_transfer_item(p.expense),
            income_txn=_transfer_item(p.income),
        )
        for p in find_internal_transfer_pairs(txns, members)
    ]


@router.get("/internal-transfers", response_model=InternalTransferListResponse)
async def list_internal_transfer_pairs(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> InternalTransferListResponse:
    """Lists money moved between the household's own accounts (counted once as expense, once as income)."""
    ledger, _ = membership
    pairs = await _detect_transfer_pairs(db, ledger.id)
    return InternalTransferListResponse(
        pairs=pairs,
        total_count=len(pairs),
        total_amount=sum((p.amount for p in pairs), Decimal(0)),
    )


@router.post("/internal-transfers/resolve", response_model=InternalTransferResolveResponse)
async def resolve_internal_transfer_pairs(
    payload: InternalTransferResolveRequest,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> InternalTransferResolveResponse:
    """Deletes both sides of detected internal transfers so they stop inflating income and expense."""
    ledger, _ = membership
    pairs = await _detect_transfer_pairs(db, ledger.id)

    txn_ids_to_delete: set[UUID] = set()
    wanted = set(payload.pair_ids or [])
    for p in pairs:
        if payload.delete_all_detected or p.pair_id in wanted:
            txn_ids_to_delete.update((p.expense_txn.id, p.income_txn.id))
    if not payload.delete_all_detected and payload.transaction_ids:
        txn_ids_to_delete.update(payload.transaction_ids)

    if not txn_ids_to_delete:
        return InternalTransferResolveResponse(
            deleted_count=0,
            freed_amount=Decimal(0),
            message="제거할 내부 이체 거래가 없습니다.",
        )

    stmt = select(Transaction).where(
        Transaction.ledger_id == ledger.id,
        Transaction.id.in_(txn_ids_to_delete),
    )
    txns_to_delete = list((await db.exec(stmt)).all())
    await _delete_as_dismissed(db, txns_to_delete)

    pair_count = len(txns_to_delete) // 2
    pair_amount = sum((t.amount for t in txns_to_delete if t.type == TransactionType.EXPENSE), Decimal(0))
    return InternalTransferResolveResponse(
        deleted_count=len(txns_to_delete),
        freed_amount=pair_amount,
        message=(
            f"내부 이체 {pair_count}쌍({len(txns_to_delete)}건)을 정리했습니다. "
            f"수입과 지출에서 각각 {pair_amount:,.0f}원의 중복 집계가 제거되었습니다."
        ),
    )


async def _repair_types_from_balance(
    db: AsyncSession, ledger_id: UUID, categories: list[Category], members: set[str]
) -> tuple[int, int, Decimal]:
    """Fixes income/expense direction of statement imports using their 잔액 balance chain.

    Returns (to_income_count, to_expense_count, moved_amount). A flipped transaction's old
    category belongs to the wrong type, so it is re-guessed (or cleared).
    """
    from app.services.statement_parser import _guess_category_by_rules

    txns = list((await db.exec(select(Transaction).where(Transaction.ledger_id == ledger_id))).all())
    inferred = infer_types_from_balance(txns)

    to_income = to_expense = 0
    moved = Decimal(0)
    for t in txns:
        true_type = inferred.get(t.id)
        if true_type is None or true_type == t.type:
            continue
        t.type = true_type
        cat_id, _ = _guess_category_by_rules(
            f"{t.payee or ''} {t.memo or ''}",
            categories,
            txn_type=true_type.value,
            amount=float(t.amount),
            member_names=members,
        )
        t.category_id = cat_id
        db.add(t)
        moved += t.amount
        if true_type == TransactionType.INCOME:
            to_income += 1
        else:
            to_expense += 1

    if to_income or to_expense:
        await db.commit()
    return to_income, to_expense, moved


@router.post("/fix-legacy-incomes", response_model=FixLegacyIncomesResponse)
async def fix_legacy_incomes_endpoint(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> FixLegacyIncomesResponse:
    """Repairs income/expense direction of imported bank statement rows from their balance history."""
    from app.services.categories import ensure_standard_categories

    ledger, _ = membership
    categories = await ensure_standard_categories(db, ledger.id)
    txns = list((await db.exec(select(Transaction).where(Transaction.ledger_id == ledger.id))).all())
    members = await ledger_member_names(db, ledger.id, txns)
    to_income, to_expense, moved = await _repair_types_from_balance(db, ledger.id, categories, members)

    if to_income or to_expense:
        msg = (
            f"잔액 기록으로 입출금 방향을 검증해 {to_income + to_expense}건을 바로잡았습니다.\n"
            f"• 지출 → 수입: {to_income}건\n"
            f"• 수입 → 지출: {to_expense}건\n"
            "방향이 바뀐 거래는 카테고리를 다시 지정했습니다. 남은 미분류 거래는 '자동 분류'로 정리하세요."
        )
    else:
        msg = "잔액 기록과 비교한 결과 모든 거래의 수입/지출 방향이 올바릅니다."
    return FixLegacyIncomesResponse(converted_count=to_income + to_expense, converted_amount=moved, message=msg)


@router.post("/batch-categorize", response_model=BatchCategorizeResponse)
async def batch_auto_categorize_transactions(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
    force_all: bool = Query(default=False, description="Re-evaluate all transactions even if already categorized"),
    reclassify_misc: bool = Query(default=True, description="Also re-evaluate transactions currently in 기타 지출 / 기타 수입 to refine them"),
    deduplicate_transfers: bool = Query(default=False, description="Automatically remove detected internal transfer pairs"),
    repair_types: bool = Query(default=False, description="Fix income/expense direction from the statement balance history first"),
) -> BatchCategorizeResponse:
    from app.services.ai import is_ai_enabled, suggest_categories_batch
    from app.services.categories import ensure_standard_categories
    from app.services.statement_parser import _guess_category_by_rules

    ledger, _ = membership
    # Ensure standard categories exist (adds 보험, 금융/대출, 저축/투자, 경조사/선물, 용돈 if missing)
    categories = await ensure_standard_categories(db, ledger.id)
    cat_by_id = {c.id: c for c in categories}
    all_txns = list((await db.exec(select(Transaction).where(Transaction.ledger_id == ledger.id))).all())
    members = await ledger_member_names(db, ledger.id, all_txns)

    repaired_count = 0
    if repair_types:
        to_income, to_expense, _ = await _repair_types_from_balance(db, ledger.id, categories, members)
        repaired_count = to_income + to_expense

    removed_transfers_count = 0
    if deduplicate_transfers:
        pairs = await _detect_transfer_pairs(db, ledger.id)
        tids = [p.expense_txn.id for p in pairs] + [p.income_txn.id for p in pairs]
        if tids:
            del_stmt = select(Transaction).where(Transaction.ledger_id == ledger.id, Transaction.id.in_(tids))
            to_delete = list((await db.exec(del_stmt)).all())
            await _delete_as_dismissed(db, to_delete)
            removed_transfers_count = len(to_delete)

    misc_cat_ids = {c.id for c in categories if c.name in ("기타 지출", "기타 수입", "기타")}

    def needs_review(t: Transaction) -> bool:
        cat = cat_by_id.get(t.category_id) if t.category_id else None
        if cat is None or cat.type != t.type:
            return True
        return force_all or (reclassify_misc and t.category_id in misc_cat_ids)

    txns = [
        t
        for t in (await db.exec(select(Transaction).where(Transaction.ledger_id == ledger.id))).all()
        if needs_review(t)
    ]
    total_processed = len(txns)

    extra_parts: list[str] = []
    if repaired_count:
        extra_parts.append(f"입출금 방향 {repaired_count}건 교정")
    if removed_transfers_count:
        extra_parts.append(f"내부 이체 {removed_transfers_count}건 정리")

    if total_processed == 0:
        msg = "분류할 대상 거래가 없습니다."
        if extra_parts:
            msg += f" ({', '.join(extra_parts)})"
        return BatchCategorizeResponse(
            total_processed=0,
            categorized_count=0,
            rules_count=0,
            ai_count=0,
            remaining_count=0,
            removed_transfers_count=removed_transfers_count,
            message=msg,
        )

    rules_count = 0
    ai_count = 0

    # Phase 1: High-speed rule-based classification (in-memory keyword matching)
    remaining_txns: list[Transaction] = []
    for txn in txns:
        corpus = f"{txn.payee or ''} {txn.memo or ''}".strip()
        cat_id, _ = _guess_category_by_rules(
            corpus, categories, txn_type=txn.type.value, amount=float(txn.amount), member_names=members
        )
        current = cat_by_id.get(txn.category_id) if txn.category_id else None
        current_valid = current is not None and current.type == txn.type
        if cat_id and cat_id != txn.category_id:
            txn.category_id = cat_id
            rules_count += 1
            db.add(txn)
        elif not cat_id:
            if not current_valid and txn.category_id is not None:
                # Category of the opposite type (e.g. an expense filed under 급여) is never right.
                txn.category_id = None
                db.add(txn)
            if txn.category_id is None:
                remaining_txns.append(txn)

    # Immediately commit rule-based classifications so they are never lost even if network issues occur
    await db.commit()

    # Phase 2: Batch AI classification with Gemini (chunks of 40 to ensure response in < 3s)
    if is_ai_enabled() and remaining_txns:
        ai_candidates = [t for t in remaining_txns if t.payee or t.memo]
        chunk_size = 40
        # Process up to 3 chunks (120 items) per invocation to guarantee fast response
        for i in range(0, min(len(ai_candidates), 120), chunk_size):
            chunk = ai_candidates[i : i + chunk_size]
            payload = [
                {"id": str(t.id), "type": t.type.value, "payee": t.payee, "memo": t.memo}
                for t in chunk
            ]
            matched_map = suggest_categories_batch(payload, categories)
            chunk_updated = False
            for t in chunk:
                cat_id = matched_map.get(str(t.id))
                cat = cat_by_id.get(cat_id) if cat_id else None
                if cat is not None and cat.type == t.type:
                    t.category_id = cat.id
                    ai_count += 1
                    db.add(t)
                    chunk_updated = True
            if chunk_updated:
                await db.commit()

    categorized_count = rules_count + ai_count
    remaining = total_processed - categorized_count

    msg_parts = [f"총 {total_processed}건 검토 중 {categorized_count}건 분류 (규칙: {rules_count}건, AI: {ai_count}건)"]
    msg_parts.extend(extra_parts)
    if remaining > 0:
        msg_parts.append(f"미분류/유지: {remaining}건")

    return BatchCategorizeResponse(
        total_processed=total_processed,
        categorized_count=categorized_count,
        rules_count=rules_count,
        ai_count=ai_count,
        remaining_count=remaining,
        removed_transfers_count=removed_transfers_count,
        message=", ".join(msg_parts),
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
    if memo_balance(txn.memo) is not None:
        # A bank-statement row the user removed on purpose should not come back on re-import.
        # (Bulk delete is used to undo a whole import, so it does not leave fingerprints.)
        await _delete_as_dismissed(db, [txn], reason="deleted")
        return
    await db.delete(txn)
    await db.commit()

