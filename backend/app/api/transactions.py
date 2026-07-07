from collections.abc import Sequence
from datetime import date
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
    TransactionTag,
)
from app.models.category import TransactionType
from app.schemas.tag import TagPublic
from app.schemas.transaction import TransactionCreate, TransactionPublic, TransactionUpdate
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


def _to_public(txn: Transaction, tags: list[Tag]) -> TransactionPublic:
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
        created_at=txn.created_at,
    )


@router.get("", response_model=list[TransactionPublic])
async def list_transactions(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    type: TransactionType | None = None,
    category_id: UUID | None = None,
    tag_id: UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    q: str | None = Query(default=None, max_length=200, description="Search in payee/memo"),
    limit: int = Query(default=100, le=500),
    offset: int = 0,
) -> list[TransactionPublic]:
    ledger, _ = membership
    if await materialize_due_for_ledger(db, ledger.id) > 0:
        await db.commit()
    stmt = select(Transaction).where(Transaction.ledger_id == ledger.id)
    if type is not None:
        stmt = stmt.where(Transaction.type == type)
    if category_id is not None:
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
        stmt = stmt.where(
            (Transaction.payee.ilike(pattern)) | (Transaction.memo.ilike(pattern))
        )
    stmt = stmt.order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
    stmt = stmt.offset(offset).limit(limit)
    txns = list((await db.exec(stmt)).all())

    tag_map = await _tags_by_transaction(db, [t.id for t in txns])
    return [_to_public(t, tag_map.get(t.id, [])) for t in txns]


@router.post("", response_model=TransactionPublic, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> TransactionPublic:
    ledger, member = membership
    await _validate_category(db, ledger.id, payload.category_id, payload.type)
    tags = await _resolve_tags(db, ledger.id, payload.tag_ids)

    data = payload.model_dump(exclude={"tag_ids"})
    txn = Transaction(ledger_id=ledger.id, created_by_id=member.user_id, **data)
    db.add(txn)
    await db.flush()
    await _set_transaction_tags(db, txn.id, [t.id for t in tags])
    await db.commit()
    await db.refresh(txn)
    return _to_public(txn, tags)


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
    return _to_public(txn, tag_map.get(txn.id, []))


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

    await db.commit()
    await db.refresh(txn)

    if tags is None:
        tag_map = await _tags_by_transaction(db, [txn.id])
        tags = tag_map.get(txn.id, [])
    return _to_public(txn, tags)


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
