from datetime import date
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import (
    Ledger,
    LedgerMember,
    LedgerRole,
    RecurringCheck,
    RecurringTransaction,
)
from app.schemas.checklist import ChecklistItem, ChecklistMonth, ChecklistUpdate
from app.services.checklist import (
    KST,
    occurrence_in_month,
    parse_period,
    period_key,
    today_kst,
)

router = APIRouter(prefix="/ledgers/{ledger_id}/checklist", tags=["checklist"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)

PERIOD_QUERY = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM; defaults to this month")


def _is_done(check: RecurringCheck | None) -> bool:
    return bool(check and check.checked_funded and check.checked_paid and check.checked_amount)


async def build_month(db, ledger_id: UUID, period: str) -> ChecklistMonth:
    year, month = parse_period(period)

    rules = list(
        (await db.exec(select(RecurringTransaction).where(RecurringTransaction.ledger_id == ledger_id))).all()
    )
    checks = {
        c.recurring_id: c
        for c in (
            await db.exec(
                select(RecurringCheck).where(
                    RecurringCheck.period == period,
                    RecurringCheck.recurring_id.in_([r.id for r in rules]),
                )
            )
        ).all()
    }

    items: list[ChecklistItem] = []
    for rule in rules:
        applies, due = occurrence_in_month(
            rule.frequency,
            rule.interval,
            rule.start_date,
            rule.end_date,
            year,
            month,
            created_on=rule.created_at.astimezone(KST).date(),
        )
        # Paused rules stay out of the list unless that month already has ticks,
        # so history is preserved without showing phantom "missed" bills.
        if not applies or (not rule.active and rule.id not in checks):
            continue
        check = checks.get(rule.id)
        items.append(
            ChecklistItem(
                recurring_id=rule.id,
                category_id=rule.category_id,
                type=rule.type,
                title=rule.title,
                payee=rule.payee,
                memo=rule.memo,
                amount=rule.amount,
                currency=rule.currency,
                frequency=rule.frequency,
                due_date=due,
                checked_funded=bool(check and check.checked_funded),
                checked_paid=bool(check and check.checked_paid),
                checked_amount=bool(check and check.checked_amount),
                done=_is_done(check),
            )
        )

    # Manually placed rules come first in their saved order; anything not placed
    # yet (e.g. just created) follows, by due date.
    order = {r.id: r.sort_order for r in rules}

    def sort_key(i: ChecklistItem):
        pos = order.get(i.recurring_id)
        return (
            pos is None,
            pos if pos is not None else 0,
            i.due_date is None,
            i.due_date or date.max,
            i.title or i.payee or "",
        )

    items.sort(key=sort_key)
    completed = sum(1 for i in items if i.done)
    pending = sum(1 for i in items if not (i.checked_funded or i.checked_paid or i.checked_amount))
    return ChecklistMonth(
        period=period,
        items=items,
        total=len(items),
        completed=completed,
        in_progress=len(items) - completed - pending,
        pending=pending,
    )


@router.get("", response_model=ChecklistMonth)
async def get_checklist(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    period: Annotated[str | None, PERIOD_QUERY] = None,
) -> ChecklistMonth:
    ledger, _ = membership
    return await build_month(db, ledger.id, period or period_key(today_kst()))


class ChecklistOrder(BaseModel):
    recurring_ids: list[UUID] = Field(max_length=500)


@router.put("/order", status_code=204)
async def set_order(
    payload: ChecklistOrder,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> None:
    """Save the display order. `recurring_ids` is the order of the items the
    client is showing (one month's subset). Rules not in that month keep their
    place: the shown rules are re-dealt, in the submitted order, into the slots
    the shown rules already occupy in the ledger-wide order."""
    ledger, _ = membership
    rules = list(
        (await db.exec(select(RecurringTransaction).where(RecurringTransaction.ledger_id == ledger.id))).all()
    )
    by_id = {r.id: r for r in rules}
    ids = payload.recurring_ids
    if len(set(ids)) != len(ids) or any(i not in by_id for i in ids):
        raise HTTPException(status_code=400, detail="Invalid recurring rule list")

    current = sorted(
        rules,
        key=lambda r: (r.sort_order is None, r.sort_order if r.sort_order is not None else 0, r.next_due_date),
    )
    submitted = set(ids)
    deal = iter(ids)
    final = [by_id[next(deal)] if r.id in submitted else r for r in current]
    for idx, rule in enumerate(final):
        rule.sort_order = idx
        db.add(rule)
    await db.commit()


@router.delete("/order", status_code=204)
async def reset_order(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> None:
    """Forget the manual order; the checklist goes back to due-date order."""
    ledger, _ = membership
    rules = (
        await db.exec(select(RecurringTransaction).where(RecurringTransaction.ledger_id == ledger.id))
    ).all()
    for rule in rules:
        rule.sort_order = None
        db.add(rule)
    await db.commit()


@router.patch("/{recurring_id}", response_model=ChecklistItem)
async def update_check(
    recurring_id: UUID,
    payload: ChecklistUpdate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> ChecklistItem:
    ledger, _ = membership
    rule = await db.get(RecurringTransaction, recurring_id)
    if rule is None or rule.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Recurring rule not found")

    period = payload.period or period_key(today_kst())
    changes = {
        k: v
        for k, v in payload.model_dump(exclude_unset=True, exclude={"period"}).items()
        if v is not None
    }

    # Upsert so two quick taps on the same rule (two concurrent first-time
    # inserts) can't trip the (rule, period) unique constraint.
    values = {
        "id": uuid4(),
        "recurring_id": recurring_id,
        "period": period,
        "checked_funded": False,
        "checked_paid": False,
        "checked_amount": False,
        **changes,
    }
    stmt = pg_insert(RecurringCheck).values(**values)
    if changes:
        stmt = stmt.on_conflict_do_update(
            constraint="uq_recurring_checks_rule_period", set_={**changes, "updated_at": func.now()}
        )
    else:
        stmt = stmt.on_conflict_do_nothing(constraint="uq_recurring_checks_rule_period")
    await db.execute(stmt)
    await db.commit()

    check = (
        await db.exec(
            select(RecurringCheck).where(
                RecurringCheck.recurring_id == recurring_id, RecurringCheck.period == period
            )
        )
    ).one()

    month = await build_month(db, ledger.id, period)
    for item in month.items:
        if item.recurring_id == recurring_id:
            return item
    # Rule doesn't apply to this month (e.g. yearly bill in another month) but a
    # tick was stored; echo the stored state back.
    return ChecklistItem(
        recurring_id=rule.id,
        category_id=rule.category_id,
        type=rule.type,
        title=rule.title,
        payee=rule.payee,
        memo=rule.memo,
        amount=rule.amount,
        currency=rule.currency,
        frequency=rule.frequency,
        due_date=None,
        checked_funded=check.checked_funded,
        checked_paid=check.checked_paid,
        checked_amount=check.checked_amount,
        done=_is_done(check),
    )
