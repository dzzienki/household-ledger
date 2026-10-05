import asyncio
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import delete, select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models import (
    Ledger,
    LedgerMember,
    NotificationLog,
    PushSubscription,
    RecurringCheck,
    RecurringTransaction,
    User,
)
from app.services.checklist import KST, occurrence_in_month, shift_month
from app.services.push import send_push_to_user

logger = logging.getLogger(__name__)

# A missed bill is flagged on the days right after its due date, then dropped.
OVERDUE_WINDOW_DAYS = 3


def classify(today: date, due: date, days_before: int) -> str | None:
    """Which reminder (if any) applies to a bill due on `due` as of `today`.

    'upcoming' fires from `days_before` days ahead until the due date,'due' on
    the day itself, 'overdue' for a few days after. Each kind is sent once per
    bill (the notification log dedupes), so catching up after downtime still
    sends exactly one."""
    if today == due:
        return "due"
    if days_before > 0 and due - timedelta(days=days_before) <= today < due:
        return "upcoming"
    if due < today <= due + timedelta(days=OVERDUE_WINDOW_DAYS):
        return "overdue"
    return None


def _fmt_amount(amount: Decimal, currency: str) -> str:
    if currency in ("KRW", "JPY", "VND"):
        return f"{int(amount):,}원" if currency == "KRW" else f"{int(amount):,} {currency}"
    return f"{amount:,.2f} {currency}"


def _name(rule: RecurringTransaction) -> str:
    return rule.title or rule.payee or "반복 거래"


_TITLES = {
    "upcoming": "📅 곧 납부일이에요",
    "due": "💸 오늘 납부일이에요",
    "overdue": "⚠️ 아직 확인하지 않았어요",
}


async def run_reminders_once(now: datetime | None = None) -> int:
    """Send any due reminders. Returns the number of notifications pushed."""
    now = now or datetime.now(KST)
    today = now.date()
    pushed = 0

    async with AsyncSessionLocal() as db:
        users = list(
            (
                await db.exec(
                    select(User).where(
                        User.is_active == True,
                        User.id.in_(select(PushSubscription.user_id)),
                        User.notify_hour <= now.hour,
                    )
                )
            ).all()
        )

        for user in users:
            memberships = list(
                (await db.exec(select(LedgerMember).where(LedgerMember.user_id == user.id))).all()
            )
            ledger_ids = [m.ledger_id for m in memberships]
            if not ledger_ids:
                continue
            ledgers = {l.id: l for l in (await db.exec(select(Ledger).where(Ledger.id.in_(ledger_ids)))).all()}
            rules = list(
                (
                    await db.exec(
                        select(RecurringTransaction).where(
                            RecurringTransaction.ledger_id.in_(ledger_ids),
                            RecurringTransaction.active == True,
                        )
                    )
                ).all()
            )
            if not rules:
                continue

            # Candidate bills: due dates in last/this/next month relative to today.
            months = [shift_month(today.year, today.month, d) for d in (-1, 0, 1)]
            candidates: list[tuple[RecurringTransaction, str, date, str]] = []
            for rule in rules:
                for y, m in months:
                    applies, due = occurrence_in_month(
                        rule.frequency, rule.interval, rule.start_date, rule.end_date, y, m
                    )
                    if not applies or due is None:
                        continue
                    kind = classify(today, due, user.notify_days_before)
                    if kind:
                        candidates.append((rule, f"{y:04d}-{m:02d}", due, kind))
            if not candidates:
                continue

            checks = {
                (c.recurring_id, c.period): c
                for c in (
                    await db.exec(
                        select(RecurringCheck).where(
                            RecurringCheck.recurring_id.in_({c[0].id for c in candidates})
                        )
                    )
                ).all()
            }

            grouped: dict[tuple[UUID, str], list[tuple[RecurringTransaction, str, date]]] = defaultdict(list)
            for rule, period, due, kind in candidates:
                chk = checks.get((rule.id, period))
                if chk and chk.checked_funded and chk.checked_paid and chk.checked_amount:
                    continue  # already fully handled
                # Claim the reminder first; if another worker (or an earlier run)
                # already did, the insert returns nothing and we skip it.
                claimed = await db.execute(
                    pg_insert(NotificationLog)
                    .values(id=uuid4(), user_id=user.id, recurring_id=rule.id, period=period, kind=kind, due_date=due)
                    .on_conflict_do_nothing(constraint="uq_notification_logs_dedupe")
                    .returning(NotificationLog.id)
                )
                if claimed.first() is not None:
                    grouped[(rule.ledger_id, kind)].append((rule, period, due))
            await db.commit()

            for (ledger_id, kind), entries in grouped.items():
                shown = ", ".join(f"{_name(r)} {_fmt_amount(r.amount, r.currency)}" for r, _, _ in entries[:3])
                if len(entries) > 3:
                    shown += f" 외 {len(entries) - 3}건"
                ledger = ledgers[ledger_id]
                delivered = await send_push_to_user(
                    db,
                    user.id,
                    _TITLES[kind],
                    f"[{ledger.name}] {shown}",
                    f"{settings.FRONTEND_BASE_PATH}/ledger/{ledger_id}/checklist",
                    f"checklist-{ledger_id}-{kind}",
                )
                if delivered:
                    pushed += 1
                else:
                    # Nothing got through (e.g. transient push-service error):
                    # release the claim so the next run retries.
                    await db.execute(
                        delete(NotificationLog).where(
                            NotificationLog.user_id == user.id,
                            NotificationLog.kind == kind,
                            NotificationLog.recurring_id.in_([r.id for r, _, _ in entries]),
                            NotificationLog.period.in_([p for _, p, _ in entries]),
                        )
                    )
                    await db.commit()
    return pushed


async def reminder_loop() -> None:
    while True:
        try:
            await run_reminders_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("reminder run failed")
        await asyncio.sleep(settings.REMINDER_INTERVAL_SECONDS)
