from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import Category, Ledger, LedgerMember, LedgerRole, RecurringTransaction
from app.schemas.recurring import RecurringCreate, RecurringPublic, RecurringUpdate

router = APIRouter(prefix="/ledgers/{ledger_id}/recurring", tags=["recurring"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)


async def _validate_category(db, ledger_id: UUID, category_id: UUID | None, txn_type) -> None:
    if category_id is None:
        return
    cat = await db.get(Category, category_id)
    if cat is None or cat.ledger_id != ledger_id:
        raise HTTPException(status_code=400, detail="Invalid category for this ledger")
    if cat.type != txn_type:
        raise HTTPException(status_code=400, detail="Category type does not match")


@router.get("", response_model=list[RecurringPublic])
async def list_recurring(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> list[RecurringTransaction]:
    ledger, _ = membership
    stmt = (
        select(RecurringTransaction)
        .where(RecurringTransaction.ledger_id == ledger.id)
        .order_by(RecurringTransaction.active.desc(), RecurringTransaction.next_due_date)
    )
    return list((await db.exec(stmt)).all())


@router.post("", response_model=RecurringPublic, status_code=status.HTTP_201_CREATED)
async def create_recurring(
    payload: RecurringCreate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> RecurringTransaction:
    ledger, member = membership
    await _validate_category(db, ledger.id, payload.category_id, payload.type)

    rule = RecurringTransaction(
        ledger_id=ledger.id,
        created_by_id=member.user_id,
        next_due_date=payload.start_date,
        **payload.model_dump(),
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.patch("/{recurring_id}", response_model=RecurringPublic)
async def update_recurring(
    recurring_id: UUID,
    payload: RecurringUpdate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> RecurringTransaction:
    ledger, _ = membership
    rule = await db.get(RecurringTransaction, recurring_id)
    if rule is None or rule.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Recurring rule not found")

    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data:
        await _validate_category(db, ledger.id, data["category_id"], rule.type)

    for key, value in data.items():
        setattr(rule, key, value)

    # When the schedule's anchor date changes, realign the next due date so the
    # rule fires on the newly chosen day rather than the stale one.
    if "start_date" in data:
        rule.next_due_date = data["start_date"]

    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/{recurring_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recurring(
    recurring_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> None:
    ledger, _ = membership
    rule = await db.get(RecurringTransaction, recurring_id)
    if rule is None or rule.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Recurring rule not found")
    await db.delete(rule)
    await db.commit()
