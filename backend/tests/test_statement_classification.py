"""Statement import, categorization, duplicate and transfer logic.

Every case here reproduces a bug that was found in real data or in adversarial review, so a
regression shows up as a failing test instead of as wrong household numbers.
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import Category, Transaction
from app.models.category import TransactionType as T
from app.services.ledger_cleanup import (
    DuplicateMatcher,
    Fingerprint,
    find_internal_transfer_pairs,
    infer_types_from_balance,
    memo_balance,
)
from app.services.statement_parser import (
    _clean_amount,
    _guess_category_by_rules,
    _normalize_date,
    _parse_raw_table,
    household_member_names,
)

LEDGER = uuid4()
EXPENSE_NAMES = [
    "식비", "교통", "주거", "통신", "의료", "쇼핑", "문화/여가", "교육", "보험",
    "금융/대출", "저축/투자", "경조사/선물", "용돈", "기타 지출",
]
INCOME_NAMES = ["급여", "부수입", "이자/배당", "기타 수입"]
CATS = [Category(id=uuid4(), ledger_id=LEDGER, name=n, type=T.EXPENSE) for n in EXPENSE_NAMES] + [
    Category(id=uuid4(), ledger_id=LEDGER, name=n, type=T.INCOME) for n in INCOME_NAMES
]
MEMBERS = {"홍길동", "김영희"}
TOSS_HEADER = ["거래 일시", "적요", "거래 유형", "거래 기관", "계좌번호", "거래 금액", "거래 후 잔액", "메모"]


def parse(rows, members=None):
    return [(i.type, i.amount) for i in _parse_raw_table(rows, CATS, members).items]


def category(text, txn_type="expense", amount=None):
    return _guess_category_by_rules(text, CATS, txn_type=txn_type, amount=amount, member_names=MEMBERS)[1]


# --- Amount / date parsing ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("-5,000", -5000.0),
        ("−5,000", -5000.0),  # unicode minus
        ("(1,000)", -1000.0),  # accounting negative
        ("+3,400,000", 3400000.0),
        ("1,234원", 1234.0),
        ("-", None),
        ("", None),
        ("국민 123-***", None),
    ],
)
def test_clean_amount(raw, expected):
    assert _clean_amount(raw) == expected


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("2026.11.01 09:00:00", "2026-11-01"),
        ("26.07.01", "2026-07-01"),
        ("2026년 3월 5일", "2026-03-05"),
        ("20260305", "2026-03-05"),
        ("45962", "2025-11-01"),  # Excel serial date
        (45962.375, "2025-11-01"),
        (datetime(2026, 1, 2, 10, 0), "2026-01-02"),
        ("합계", None),
    ],
)
def test_normalize_date(raw, expected):
    assert _normalize_date(raw) == expected


# --- Income / expense direction from statements -------------------------------------------------


def test_toss_export_sign_decides_direction_not_type_label():
    rows = [
        TOSS_HEADER,
        ["2026.11.01", "김영희(모임통장)", "모임원송금", "", "", "-800,000", "2,877,079", "공과금"],
        ["2026.10.31", "홍길동", "입금", "", "", "3,400,000", "3,677,079", ""],
        # "자동이체" label but money came IN (적금 해지) - the old code made this an expense
        ["2026.10.30", "내계좌간자동이체", "자동이체", "", "", "1,000,000", "277,079", "적금 해지"],
        ["2026.10.29", "스타벅스", "체크카드결제", "", "", "-5,000", "-722,921", ""],
    ]
    assert parse(rows, MEMBERS) == [
        ("expense", 800000.0),
        ("income", 3400000.0),
        ("income", 1000000.0),
        ("expense", 5000.0),
    ]


def test_short_toss_export_without_visible_chain():
    assert parse([TOSS_HEADER, ["2026.11.01", "관리비", "출금", "", "", "-200,000", "50,000", ""]]) == [
        ("expense", 200000.0)
    ]
    assert parse([TOSS_HEADER, ["2026.11.01", "홍길동", "입금", "", "", "3,000,000", "3,050,000", ""]]) == [
        ("income", 3000000.0)
    ]


def test_deposit_withdrawal_columns():
    rows = [
        ["거래일자", "내용", "출금액", "입금액", "잔액"],
        ["2026-10-01", "급여", "", "3,000,000", "3,100,000"],
        ["2026-10-02", "월세", "500,000", "", "2,600,000"],
    ]
    assert parse(rows) == [("income", 3000000.0), ("expense", 500000.0)]


@pytest.mark.parametrize(
    "header, extra",
    [
        ("결제후잔액", ["200000", "0", "0"]),  # installment remainder, not an account balance
        ("출금계좌", ["국민 123-***"] * 3),  # "출금" keyword on a non-amount column
        ("입금예정일", ["2026-11-15"] * 3),  # "입금" keyword on a date column
    ],
)
def test_card_statement_charges_are_expenses(header, extra):
    rows = [
        ["이용일", "가맹점명", "이용금액", header],
        ["2026-10-01", "쿠팡", "300000", extra[0]],
        ["2026-10-02", "이마트", "50000", extra[1]],
        ["2026-10-03", "이마트", "-50000", extra[2]],  # refund
    ]
    assert parse(rows) == [("expense", 300000.0), ("expense", 50000.0), ("income", 50000.0)]


def test_card_company_statement_with_plain_balance_column():
    rows = [
        ["KB국민카드 이용내역"],
        ["이용일", "가맹점명", "이용금액", "잔액"],
        ["2026-10-01", "쿠팡", "300000", "200000"],
        ["2026-10-02", "이마트", "50000", "0"],
    ]
    assert parse(rows) == [("expense", 300000.0), ("expense", 50000.0)]


def test_card_cancel_flag_with_positive_amount():
    rows = [["이용일", "가맹점명", "이용금액", "구분"], ["2026-10-03", "이마트", "12000", "승인취소"]]
    assert parse(rows) == [("income", 12000.0)]


def test_summary_rows_dropped_but_memo_mentioning_total_kept():
    rows = [
        ["거래 일시", "적요", "거래 유형", "거래 금액", "거래 후 잔액", "메모"],
        ["2026.11.02", "관리비", "출금", "-100,000", "900,000", "10월 관리비 합계"],
        ["2026.11.01", "홍길동", "입금", "1,000,000", "1,000,000", ""],
        ["", "합계", "", "900,000", "", ""],
    ]
    result = _parse_raw_table(rows, CATS)
    assert [i.payee for i in result.items] == ["10월 관리비 합계", "홍길동"]
    assert result.total_amount == 1100000.0  # was double-counted before


def test_balance_kept_in_memo_for_later_matching():
    rows = [TOSS_HEADER, ["2026.11.01", "홍길동", "입금", "", "", "3,000,000", "3,050,000", ""]]
    item = _parse_raw_table(rows, CATS).items[0]
    assert memo_balance(item.memo) == Decimal("3050000")


# --- Household members --------------------------------------------------------------------------


def test_member_names_from_meeting_account_labels_skip_account_names():
    found = household_member_names(["허브통장(모임통장)", "김영희(모임통장)", "적요: 생활비통장(모임원)"], ["홍길동"])
    assert found == {"김영희", "홍길동"}


# --- Category rules -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("강유리 신용대출 갚기", "금융/대출"),
        ("대출이자", "금융/대출"),
        ("명준 보험비", "보험"),
        ("강유리 11회차 적금", "저축/투자"),
        ("12월 강유리 용돈", "용돈"),  # was swallowed by 문화/여가
        ("강유리 핸드폰비", "통신"),
        ("11월 관리비", "주거"),
        ("남현교회 아는언니 축의금", "경조사/선물"),
        ("일요일 택시비", "교통"),
        ("치킨 한마리", "식비"),
        ("쿠팡(쿠페이)", "쇼핑"),
        # words that merely contain a keyword
        ("이자카야 하나", None),  # 이자
        ("주식회사 쿠팡", "쇼핑"),  # 주식
        ("예금주 확인 송금", "기타 지출"),  # 예금
        ("cucumber", None),  # cu
    ],
)
def test_expense_rules(text, expected):
    assert category(text) == expected


@pytest.mark.parametrize(
    "text, amount, expected",
    [
        ("강유리급여", 2600000, "급여"),
        ("홍길동", 3400000, "급여"),  # bare household member, salary-sized
        ("홍길동(모임통장) | 잔액 3,565,425원 | 입금", 3400000, "급여"),
        ("홍길동", 300000, "기타 수입"),
        ("통장 이자", 79, "이자/배당"),
        ("강유리적금분", 10000000, "기타 수입"),  # savings coming back is not salary
        ("관리비통장-> 허브통장", 1567126, "기타 수입"),
    ],
)
def test_income_rules(text, amount, expected):
    assert category(text, "income", amount) == expected


def test_rules_never_cross_types():
    expense_ids = {c.id for c in CATS if c.type == T.EXPENSE}
    income_ids = {c.id for c in CATS if c.type == T.INCOME}
    for text in ["급여", "통장 이자", "관리비", "적금", "홍길동", "용돈"]:
        exp_id, _ = _guess_category_by_rules(text, CATS, txn_type="expense", member_names=MEMBERS)
        inc_id, _ = _guess_category_by_rules(text, CATS, txn_type="income", amount=5_000_000, member_names=MEMBERS)
        assert exp_id is None or exp_id in expense_ids
        assert inc_id is None or inc_id in income_ids


def test_member_named_in_memo_does_not_force_misc_expense():
    # "적요: 홍길동" only says who paid from the shared account; it is not a transfer to them.
    assert category("피피카이섬투어 예약비 | 적요: 홍길동") == "문화/여가"


# --- Duplicate detection ------------------------------------------------------------------------


def fp(day=1, t=T.EXPENSE, amount="100", payee="A", balance="5000"):
    return Fingerprint(date(2026, 5, day), t, Decimal(amount), payee, None if balance is None else Decimal(balance))


def test_balance_identifies_row_even_if_description_changed():
    assert DuplicateMatcher([fp(payee="내계좌간자동이체")], []).classify(fp(payee="적금 해지")) == "existing"


def test_amount_scale_does_not_matter():
    assert DuplicateMatcher([fp(amount="100.00")], []).classify(fp(amount="100.0")) == "existing"


def test_different_balance_is_different_transaction():
    assert DuplicateMatcher([fp(balance="5000")], []).classify(fp(balance="4900")) is None


def test_other_account_ending_on_same_balance_is_not_duplicate():
    existing = fp(t=T.EXPENSE, payee="A")
    assert DuplicateMatcher([existing], []).classify(fp(t=T.INCOME, payee="B")) is None


def test_legacy_row_with_wrong_direction_still_matches():
    legacy = fp(t=T.INCOME, payee="강유리 핸드폰비")
    assert DuplicateMatcher([legacy], []).classify(fp(t=T.EXPENSE, payee="강유리 핸드폰비")) == "existing"


def test_matching_is_one_to_one():
    card = fp(payee="버스", balance=None)
    m = DuplicateMatcher([card], [])
    assert [m.classify(card), m.classify(card)] == ["existing", None]


def test_row_without_balance_matches_manual_entry_by_description():
    manual = fp(payee="스타벅스", balance=None)
    assert DuplicateMatcher([manual], []).classify(fp(payee="스타벅스", balance="5000")) == "existing"
    # but a row stored WITH another balance is not reused through the description fallback
    other = fp(payee="스타벅스", balance="9999")
    assert DuplicateMatcher([other], []).classify(fp(payee="스타벅스", balance="5000")) is None


def test_dismissed_transfers_do_not_come_back():
    m = DuplicateMatcher([], [fp(payee="3월 식비생활비")])
    assert m.classify(fp(payee="3월식비생활비")) == "dismissed"


# --- Direction repair from the balance chain ----------------------------------------------------

BASE_TIME = datetime(2026, 11, 9, 8, 0, tzinfo=UTC)
USER = uuid4()


def txn(amount, balance, t, day=1, payee="x", offset=0.0, user=USER):
    return Transaction(
        id=uuid4(),
        ledger_id=LEDGER,
        created_by_id=user,
        type=t,
        amount=Decimal(amount),
        transaction_date=date(2026, 5, day),
        payee=payee,
        memo=f"잔액 {balance:,}원",
        created_at=BASE_TIME + timedelta(milliseconds=offset),
    )


def test_infer_newest_first_chain():
    # balances 1000 -> 1500 (+500) -> 1200 (-300), file is newest first
    rows = [txn(300, 1200, T.INCOME, offset=0), txn(500, 1500, T.EXPENSE, offset=1), txn(1000, 1000, T.INCOME, offset=2)]
    inferred = infer_types_from_balance(rows)
    assert inferred[rows[0].id] == T.EXPENSE
    assert inferred[rows[1].id] == T.INCOME
    assert rows[2].id not in inferred  # no earlier row to compare with


def test_infer_oldest_first_chain():
    rows = [txn(1000, 1000, T.INCOME, offset=0), txn(500, 1500, T.EXPENSE, offset=1), txn(300, 1200, T.INCOME, offset=2)]
    inferred = infer_types_from_balance(rows)
    assert inferred[rows[1].id] == T.INCOME
    assert inferred[rows[2].id] == T.EXPENSE


def test_separate_imports_are_not_chained():
    a = txn(500, 1500, T.INCOME, offset=0)
    b = txn(500, 1000, T.INCOME, offset=60_000)  # a minute later: a different import
    assert infer_types_from_balance([a, b]) == {}


# --- Internal transfers -------------------------------------------------------------------------


def plain(amount, t, payee, memo=None, day=1):
    return Transaction(
        id=uuid4(),
        ledger_id=LEDGER,
        created_by_id=USER,
        type=t,
        amount=Decimal(amount),
        transaction_date=date(2026, 5, day),
        payee=payee,
        memo=memo,
        created_at=BASE_TIME,
    )


def pair_names(txns):
    return [(p.expense.payee, p.income.payee) for p in find_internal_transfer_pairs(txns, MEMBERS)]


def test_transfer_pairs_detected():
    txns = [
        plain(610000, T.EXPENSE, "3월 공과금등"),
        plain(610000, T.INCOME, "3월공과금"),
        plain(400000, T.EXPENSE, "김영희(모임통장)"),
        plain(400000, T.INCOME, "생활비"),
    ]
    assert sorted(pair_names(txns)) == [("3월 공과금등", "3월공과금"), ("김영희(모임통장)", "생활비")]


def test_real_spending_reimbursed_by_member_is_not_a_transfer():
    # 전기세 paid from the shared account; a member sent the same amount. Spending stays.
    txns = [
        plain(64720, T.EXPENSE, "전기세", memo="적요: 김영희(모임통장)"),
        plain(64720, T.INCOME, "홍길동"),
    ]
    assert pair_names(txns) == []


def test_merchant_purchase_is_never_a_transfer():
    # The income side says 생활비 (a transfer word), but the expense is a real Coupang purchase.
    txns = [plain(25890, T.EXPENSE, "쿠팡(쿠페이)"), plain(25890, T.INCOME, "생활비 보탬")]
    assert pair_names(txns) == []


def test_two_expenses_are_never_paired():
    txns = [plain(330000, T.EXPENSE, "홍길동"), plain(330000, T.EXPENSE, "홍길동")]
    assert pair_names(txns) == []


def test_each_transaction_used_in_one_pair_only():
    txns = [
        plain(400000, T.EXPENSE, "생활비"),
        plain(400000, T.EXPENSE, "생활비"),
        plain(400000, T.INCOME, "생활비"),
    ]
    assert len(pair_names(txns)) == 1
