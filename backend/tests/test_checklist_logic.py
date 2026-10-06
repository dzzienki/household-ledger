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


def occ_created(freq, start, created, y, m, interval=1, end=None):
    return occurrence_in_month(freq, interval, start, end, y, m, created_on=created)


def test_monthly_rule_created_after_this_months_day_still_shows_this_month():
    # "monthly on the 1st" made on Oct 5: the app stores start_date = Nov 1.
    start, created = date(2026, 11, 1), date(2026, 10, 5)
    assert occ_created(F.MONTHLY, start, created, 2026, 9)[0] is False
    assert occ_created(F.MONTHLY, start, created, 2026, 10) == (True, date(2026, 10, 1))
    assert occ_created(F.MONTHLY, start, created, 2026, 11) == (True, date(2026, 11, 1))
    # Without created_on (reminders) October stays excluded: no retroactive pushes.
    assert occ(F.MONTHLY, start, 2026, 10) == (False, None)


def test_created_on_does_not_pull_in_months_before_creation_month():
    start, created = date(2026, 11, 1), date(2026, 10, 5)
    assert occ_created(F.MONTHLY, start, created, 2026, 8)[0] is False
    # Rule whose start is well after creation (e.g. begins next year) is untouched.
    assert occ_created(F.MONTHLY, date(2027, 3, 1), created, 2026, 10)[0] is False
    assert occ_created(F.MONTHLY, date(2027, 3, 1), created, 2027, 2)[0] is False


def test_quarterly_rule_only_includes_the_immediately_previous_occurrence():
    start, created = date(2026, 12, 10), date(2026, 10, 5)
    assert occ_created(F.MONTHLY, start, created, 2026, 9, interval=3)[0] is False
    assert occ_created(F.MONTHLY, start, created, 2026, 10, interval=3)[0] is False  # off-phase
    assert occ_created(F.MONTHLY, start, created, 2026, 12, interval=3)[0] is True
    # previous occurrence (Sep) is before the creation month -> excluded
    assert occ_created(F.MONTHLY, start, created, 2026, 9, interval=3)[0] is False


def test_yearly_rule_includes_previous_year_only_if_created_in_that_month_or_later():
    assert occ_created(F.YEARLY, date(2027, 10, 3), date(2026, 10, 5), 2026, 10) == (True, date(2026, 10, 3))
    assert occ_created(F.YEARLY, date(2027, 3, 20), date(2026, 10, 5), 2026, 3)[0] is False


def test_end_date_still_applies_with_created_on():
    start, created = date(2026, 11, 1), date(2026, 10, 5)
    assert occ_created(F.MONTHLY, start, created, 2026, 10, end=date(2026, 9, 30))[0] is False
