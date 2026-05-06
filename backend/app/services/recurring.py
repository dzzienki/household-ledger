import calendar
from datetime import date, timedelta
from uuid import UUID

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import RecurrenceFrequency, RecurringTransaction, Transaction


def advance_date(d: date, frequency: RecurrenceFrequency, interval: int) -> date:
    if frequency == RecurrenceFrequency.DAILY:
        return d + timedelta(days=interval)
    if frequency == RecurrenceFrequency.WEEKLY:
        return d + timedelta(days=7 * interval)
    if frequency == RecurrenceFrequency.MONTHLY:
        m_index = d.month - 1 + interval
        year = d.year + m_index // 12
        month = m_index % 12 + 1
        day = min(d.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)
    if frequency == RecurrenceFrequency.YEARLY:
        try:
            return d.replace(year=d.year + interval)
        except ValueError:
            return date(d.year + interval, 2, 28)
    raise ValueError(f"Unknown frequency: {frequency}")


async def materialize_due_for_ledger(db: AsyncSession, ledger_id: UUID, today: date | None = None) -> int:
    """Generate Transaction rows for any RecurringTransaction whose next_due_date <= today.

    Returns the number of generated transactions.
    """
    today = today or date.today()
    stmt = select(RecurringTransaction).where(
        RecurringTransaction.ledger_id == ledger_id,
        RecurringTransaction.active == True,  # noqa: E712
        RecurringTransaction.next_due_date <= today,
    )
    rules = list((await db.exec(stmt)).all())
    if not rules:
        return 0

    generated = 0
    for rule in rules:
        cursor = rule.next_due_date
        while cursor <= today:
            if rule.end_date is not None and cursor > rule.end_date:
                rule.active = False
                break
            db.add(
                Transaction(
                    ledger_id=rule.ledger_id,
                    category_id=rule.category_id,
                    created_by_id=rule.created_by_id,
                    type=rule.type,
                    amount=rule.amount,
                    currency=rule.currency,
                    transaction_date=cursor,
                    payee=rule.payee,
                    memo=rule.memo,
                )
            )
            generated += 1
            cursor = advance_date(cursor, rule.frequency, rule.interval)
        rule.next_due_date = cursor
        if rule.end_date is not None and cursor > rule.end_date:
            rule.active = False
        db.add(rule)

    await db.flush()
    return generated
