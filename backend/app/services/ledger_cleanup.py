"""Ledger-wide data repair for imported bank statements.

- Income/expense direction repair: bank statement imports keep the running balance in the memo
  ("잔액 1,234원"). Consecutive rows of one import form a balance chain, so the sign of each
  row is simply the balance difference to the previous row. This is ground truth and replaces
  any keyword guessing about whether money came in or went out.
- Internal transfer detection: when several of the household's own accounts are imported into
  one ledger, money moved between them shows up twice (an expense in one account and an income
  in the other). Such pairs are neither real income nor real spending.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import LedgerMember, Transaction, User
from app.models.category import TransactionType
from app.services.statement_parser import household_member_names

_BALANCE_RE = re.compile(r"잔액\s*(-?[\d,]+)\s*원")
# Rows inserted by one statement import are created within milliseconds of each other.
_IMPORT_BATCH_GAP = timedelta(seconds=5)

# Words that indicate money moving between the household's own accounts.
_TRANSFER_HINTS = [
    "모임통장", "모임원", "통장", "이체", "송금", "수혈", "수급", "보탬", "옮김", "전환", "보냄",
    "생활비", "공과금", "모은돈", "충전",
]
# Merchants: a purchase is never one side of an internal transfer.
_MERCHANT_HINTS = [
    "스타벅스", "이디야", "투썸", "메가mgc", "빽다방", "컴포즈", "커피", "카페", "베이커리", "식당",
    "치킨", "버거", "맥도날드", "피자", "배달의민족", "요기요", "쿠팡", "이마트", "홈플러스", "롯데마트",
    "gs25", "세븐일레븐", "마트", "약국", "병원", "의원", "치과", "cgv", "롯데시네마", "메가박스",
    "올리브영", "다이소", "(주)", "주식회사", "페이_", "토스페이",
]
_NON_WORD_RE = re.compile(r"[^가-힣a-z]")


def _balance(t: Transaction) -> Decimal | None:
    m = _BALANCE_RE.search(t.memo or "")
    if not m:
        return None
    return Decimal(m.group(1).replace(",", ""))


def _text(t: Transaction) -> str:
    return f"{t.payee or ''} {t.memo or ''}".lower()


def _import_batches(txns: list[Transaction]) -> list[list[Transaction]]:
    """Split transactions (sorted by created_at) into groups that were imported together."""
    batches: list[list[Transaction]] = []
    for t in txns:
        prev = batches[-1][-1] if batches else None
        if (
            prev is not None
            and prev.created_by_id == t.created_by_id
            and t.created_at - prev.created_at <= _IMPORT_BATCH_GAP
        ):
            batches[-1].append(t)
        else:
            batches.append([t])
    return batches


def infer_types_from_balance(txns: list[Transaction]) -> dict[UUID, TransactionType]:
    """Return the true type of every transaction whose direction is provable from the balance chain."""
    ordered = sorted(txns, key=lambda t: (t.created_at, t.id))
    inferred: dict[UUID, TransactionType] = {}

    for batch in _import_batches(ordered):
        balances = [_balance(t) for t in batch]

        def deltas(step: int) -> dict[int, Decimal]:
            # step=+1: file was newest-first (토스), the previous state is the next row.
            # step=-1: file was oldest-first, the previous state is the row before.
            out: dict[int, Decimal] = {}
            for i, t in enumerate(batch):
                j = i + step
                if not 0 <= j < len(batch):
                    continue
                if balances[i] is None or balances[j] is None:
                    continue
                d = balances[i] - balances[j]
                if d != 0 and abs(d) == t.amount:
                    out[i] = d
            return out

        newest_first, oldest_first = deltas(1), deltas(-1)
        chosen = newest_first if len(newest_first) >= len(oldest_first) else oldest_first
        for i, d in chosen.items():
            inferred[batch[i].id] = TransactionType.INCOME if d > 0 else TransactionType.EXPENSE

    return inferred


async def ledger_member_names(db: AsyncSession, ledger_id: UUID, txns: list[Transaction]) -> set[str]:
    stmt = select(User.name).join(LedgerMember, LedgerMember.user_id == User.id).where(
        LedgerMember.ledger_id == ledger_id
    )
    names = [n for n in (await db.exec(stmt)).all() if n]
    return household_member_names([t.payee or "" for t in txns] + [t.memo or "" for t in txns], names)


def _is_merchant(text: str) -> bool:
    return any(k in text for k in _MERCHANT_HINTS)


def _has_transfer_hint(text: str) -> bool:
    return any(k in text for k in _TRANSFER_HINTS)


def _bigrams(text: str, exclude: set[str]) -> set[str]:
    s = _NON_WORD_RE.sub("", text.replace("월", " "))
    for name in exclude:
        s = s.replace(name, "")
    return {s[i : i + 2] for i in range(len(s) - 1)}


def _payee_is_member(t: Transaction, members: set[str]) -> bool:
    payee = re.sub(r"\((?:모임통장|모임원|송금|입금)\)", "", t.payee or "").strip()
    return payee in members


@dataclass
class TransferPair:
    expense: Transaction
    income: Transaction


def find_internal_transfer_pairs(txns: list[Transaction], members: set[str]) -> list[TransferPair]:
    """Match an expense and an income of the same amount on the same day that look like a move
    between the household's own accounts.

    A pair is accepted when neither side is a merchant purchase and at least one of:
    - either side mentions a transfer word (모임통장, 생활비, 수혈, 이체 ...),
    - both descriptions share wording (e.g. "3월 식비생활비" ⇄ "3월식비생활비"),
    - both sides are just household member names.
    """
    incomes_by_key: dict[tuple, list[Transaction]] = defaultdict(list)
    for t in txns:
        if t.type == TransactionType.INCOME:
            incomes_by_key[(t.transaction_date, t.amount)].append(t)

    used: set[UUID] = set()
    pairs: list[TransferPair] = []
    expenses = sorted(
        (t for t in txns if t.type == TransactionType.EXPENSE),
        key=lambda t: (t.transaction_date, t.created_at),
    )
    for exp in expenses:
        exp_text = _text(exp)
        if _is_merchant(exp_text):
            continue
        for inc in incomes_by_key.get((exp.transaction_date, exp.amount), []):
            if inc.id in used:
                continue
            inc_text = _text(inc)
            if _is_merchant(inc_text):
                continue
            # Only the description counts here: the memo's 적요 often names a 모임통장 member even
            # for genuine spending paid out of the shared account.
            hinted = _has_transfer_hint((exp.payee or "").lower()) or _has_transfer_hint((inc.payee or "").lower())
            shared = len(_bigrams(exp.payee or "", members) & _bigrams(inc.payee or "", members)) >= 2
            both_people = _payee_is_member(exp, members) and _payee_is_member(inc, members)
            if hinted or shared or both_people:
                used.update((exp.id, inc.id))
                pairs.append(TransferPair(expense=exp, income=inc))
                break
    return pairs


def memo_balance(memo: str | None) -> Decimal | None:
    m = _BALANCE_RE.search(memo or "")
    return Decimal(m.group(1).replace(",", "")) if m else None


def _payee_key(payee: str | None) -> str:
    return re.sub(r"[^가-힣a-z0-9]", "", (payee or "").lower())


@dataclass
class Fingerprint:
    """What identifies one bank transaction across imports, notifications and manual entry."""

    transaction_date: date
    type: TransactionType
    amount: Decimal
    payee: str | None
    balance: Decimal | None


def _balance_key(f: Fingerprint) -> tuple:
    return (f.transaction_date, f.amount, f.balance)


def _payee_key_of(f: Fingerprint) -> tuple:
    return (f.transaction_date, f.type, f.amount, _payee_key(f.payee))


class DuplicateMatcher:
    """Decides whether an incoming row is already in the ledger (or was deliberately removed).

    - With a running balance (토스 등 은행 내역) the row is identified by date + type + amount +
      balance-after. One account has exactly one balance at that moment, so this survives
      differences in how the description was written and never merges two real purchases.
    - Without a balance (카드 명세서, 수기 입력) it falls back to date + type + amount + description.
    - Matching is one-to-one: two identical rows in the file only consume two existing rows, so a
      genuine second purchase of the same amount on the same day is still imported.
    """

    def __init__(self, existing: list[Fingerprint], dismissed: list[Fingerprint]):
        self._pools = {"existing": self._index(existing), "dismissed": self._index(dismissed)}

    @staticmethod
    def _index(rows: list[Fingerprint]) -> dict[str, dict[tuple, list[Fingerprint]]]:
        by_balance: dict[tuple, list[Fingerprint]] = defaultdict(list)
        by_payee: dict[tuple, list[Fingerprint]] = defaultdict(list)
        for r in rows:
            if r.balance is not None:
                by_balance[_balance_key(r)].append(r)
            by_payee[_payee_key_of(r)].append(r)
        return {"balance": by_balance, "payee": by_payee}

    def _take(self, pool: dict[str, dict[tuple, list[Fingerprint]]], row: Fingerprint) -> bool:
        candidates: list[Fingerprint]
        if row.balance is not None:
            same_balance = pool["balance"].get(_balance_key(row), [])
            # Same direction is the normal case. A row with the opposite direction only counts when
            # the description matches too: that is a legacy import stored with the wrong direction,
            # not a different account that happens to end on the same balance.
            candidates = [r for r in same_balance if r.type == row.type] or [
                r for r in same_balance if _payee_key(r.payee) == _payee_key(row.payee)
            ]
            if not candidates:
                # An existing row with a different balance is a different transaction; only rows
                # stored without a balance (manual entry, notification) may still be the same one.
                candidates = [r for r in pool["payee"].get(_payee_key_of(row), []) if r.balance is None]
        else:
            candidates = pool["payee"].get(_payee_key_of(row), [])
        if not candidates:
            return False
        hit = candidates[0]
        if hit.balance is not None:
            pool["balance"][_balance_key(hit)].remove(hit)
        pool["payee"][_payee_key_of(hit)].remove(hit)
        return True

    def classify(self, row: Fingerprint) -> str | None:
        """Return "existing", "dismissed" or None (new)."""
        for reason in ("existing", "dismissed"):
            if self._take(self._pools[reason], row):
                return reason
        return None


def fingerprint_of(t: Transaction) -> Fingerprint:
    return Fingerprint(
        transaction_date=t.transaction_date,
        type=t.type,
        amount=Decimal(t.amount),
        payee=t.payee,
        balance=memo_balance(t.memo),
    )
