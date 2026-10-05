import calendar
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.models.recurring import RecurrenceFrequency

KST = ZoneInfo("Asia/Seoul")
PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def today_kst() -> date:
    """'Today' for checklist purposes: bills are due on the Korean calendar day,
    regardless of the server's timezone."""
    return datetime.now(KST).date()


def period_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def parse_period(period: str) -> tuple[int, int]:
    if not PERIOD_RE.match(period):
        raise ValueError(f"Invalid period: {period}")
    return int(period[:4]), int(period[5:7])


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _clamped(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def occurrence_in_month(
    frequency: RecurrenceFrequency,
    interval: int,
    start_date: date,
    end_date: date | None,
    year: int,
    month: int,
) -> tuple[bool, date | None]:
    """Does a recurring rule belong on the checklist for the given month?

    Returns (applies, due_date). Monthly and yearly rules have a concrete due
    date. Daily and weekly rules fire many times per month, so they show up as a
    single undated line item every month they are in range (due_date is None).
    """
    month_idx = year * 12 + month - 1
    start_idx = start_date.year * 12 + start_date.month - 1
    if month_idx < start_idx:
        return False, None
    if end_date is not None and month_idx > end_date.year * 12 + end_date.month - 1:
        return False, None

    due: date | None
    if frequency == RecurrenceFrequency.MONTHLY:
        if (month_idx - start_idx) % interval != 0:
            return False, None
        due = _clamped(year, month, start_date.day)
    elif frequency == RecurrenceFrequency.YEARLY:
        if month != start_date.month or (year - start_date.year) % interval != 0:
            return False, None
        due = _clamped(year, month, start_date.day)
    else:
        return True, None

    if end_date is not None and due > end_date:
        return False, None
    return True, due
