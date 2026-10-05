from datetime import date

import pytest

from app.models.recurring import RecurrenceFrequency as F
from app.services.checklist import occurrence_in_month, parse_period, shift_month
from app.services.reminders import classify


def occ(freq, start, y, m, interval=1, end=None):
    return occurrence_in_month(freq, interval, start, end, y, m)


def test_monthly_every_month_from_start():
    start = date(2026, 3, 15)
    assert occ(F.MONTHLY, start, 2026, 2) == (False, None)
    assert occ(F.MONTHLY, start, 2026, 3) == (True, date(2026, 3, 15))
    assert occ(F.MONTHLY, start, 2027, 1) == (True, date(2027, 1, 15))


def test_monthly_day_clamped_to_month_end():
    start = date(2026, 1, 31)
    assert occ(F.MONTHLY, start, 2026, 2) == (True, date(2026, 2, 28))
    assert occ(F.MONTHLY, start, 2028, 2) == (True, date(2028, 2, 29))


def test_monthly_interval_skips_months():
    start = date(2026, 1, 10)
    assert occ(F.MONTHLY, start, 2026, 2, interval=3)[0] is False
    assert occ(F.MONTHLY, start, 2026, 4, interval=3) == (True, date(2026, 4, 10))


def test_yearly_only_in_anniversary_month():
    start = date(2025, 6, 20)
    assert occ(F.YEARLY, start, 2026, 5)[0] is False
    assert occ(F.YEARLY, start, 2026, 6) == (True, date(2026, 6, 20))
    assert occ(F.YEARLY, start, 2027, 6, interval=2) == (True, date(2027, 6, 20))
    assert occ(F.YEARLY, start, 2026, 6, interval=2)[0] is False


def test_end_date_stops_rule():
    start, end = date(2026, 1, 25), date(2026, 6, 10)
    assert occ(F.MONTHLY, start, 2026, 5, end=end)[0] is True
    # due date (25th) falls after the end date in the final month
    assert occ(F.MONTHLY, start, 2026, 6, end=end)[0] is False
    assert occ(F.MONTHLY, start, 2026, 7, end=end)[0] is False


def test_weekly_and_daily_are_undated_monthly_entries():
    start = date(2026, 1, 1)
    assert occ(F.WEEKLY, start, 2026, 8) == (True, None)
    assert occ(F.DAILY, start, 2026, 8) == (True, None)
    assert occ(F.WEEKLY, start, 2025, 12) == (False, None)


def test_period_helpers():
    assert parse_period("2026-09") == (2026, 9)
    with pytest.raises(ValueError):
        parse_period("2026-13")
    assert shift_month(2026, 1, -1) == (2025, 12)
    assert shift_month(2026, 12, 1) == (2027, 1)


def test_reminder_classification():
    due = date(2026, 10, 10)
    assert classify(date(2026, 10, 8), due, 1) is None
    assert classify(date(2026, 10, 9), due, 1) == "upcoming"
    assert classify(date(2026, 10, 9), due, 0) is None
    assert classify(date(2026, 10, 7), due, 3) == "upcoming"
    assert classify(due, due, 1) == "due"
    assert classify(date(2026, 10, 11), due, 1) == "overdue"
    assert classify(date(2026, 10, 13), due, 1) == "overdue"
    assert classify(date(2026, 10, 14), due, 1) is None
