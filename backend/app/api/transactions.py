from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import Category, Ledger, LedgerMember, LedgerRole, Transaction
from app.models.category import TransactionType
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


@router.get("", response_model=list[TransactionPublic])
async def list_transactions(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    type: TransactionType | None = None,
    category_id: UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
) -> list[Transaction]:
    ledger, _ = membership
    if await materialize_due_for_ledger(db, ledger.id) > 0:
        await db.commit()
    stmt = select(Transaction).where(Transaction.ledger_id == ledger.id)
    if type is not None:
        stmt = stmt.where(Transaction.type == type)
    if category_id is not None:
        stmt = stmt.where(Transaction.category_id == category_id)
    if start_date is not None:
        stmt = stmt.where(Transaction.transaction_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(Transaction.transaction_date <= end_date)
    stmt = stmt.order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
    stmt = stmt.offset(offset).limit(limit)
    return list((await db.exec(stmt)).all())


@router.post("", response_model=TransactionPublic, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> Transaction:
    ledger, member = membership
    await _validate_category(db, ledger.id, payload.category_id, payload.type)

    txn = Transaction(
        ledger_id=ledger.id,
        created_by_id=member.user_id,
        **payload.model_dump(),
    )
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return txn


@router.get("/{transaction_id}", response_model=TransactionPublic)
async def get_transaction(
    transaction_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> Transaction:
    ledger, _ = membership
    txn = await db.get(Transaction, transaction_id)
    if txn is None or txn.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn


@router.patch("/{transaction_id}", response_model=TransactionPublic)
async def update_transaction(
    transaction_id: UUID,
    payload: TransactionUpdate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> Transaction:
    ledger, _ = membership
    txn = await db.get(Transaction, transaction_id)
    if txn is None or txn.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Transaction not found")

    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data:
        await _validate_category(
            db, ledger.id, data["category_id"], data.get("type", txn.type)
        )

    for key, value in data.items():
        setattr(txn, key, value)
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return txn


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
