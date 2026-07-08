from datetime import date
from decimal import Decimal
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, Numeric
from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin
from app.models.category import TransactionType


class RecurrenceFrequency(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class RecurringTransaction(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    __tablename__ = "recurring_transactions"

    ledger_id: UUID = Field(foreign_key="ledgers.id", index=True)
    category_id: UUID | None = Field(default=None, foreign_key="categories.id")
    created_by_id: UUID = Field(foreign_key="users.id")

    type: TransactionType
    amount: Decimal = Field(sa_column=Column(Numeric(15, 2), nullable=False))
    currency: str = Field(default="KRW", max_length=3)

    title: str | None = Field(default=None, max_length=100)
    payee: str | None = Field(default=None, max_length=100)
    memo: str | None = Field(default=None, max_length=500)

    frequency: RecurrenceFrequency
    interval: int = Field(default=1, ge=1)
    start_date: date
    end_date: date | None = Field(default=None)
    next_due_date: date = Field(index=True)
    active: bool = Field(default=True)

    # Per-cycle autopay checklist. Reset automatically each cycle by comparing
    # checklist_period to the current period key (see api/recurring.py).
    checked_funded: bool = Field(default=False)  # 이체: 자동이체 통장에 입금
    checked_paid: bool = Field(default=False)  # 납부: 실제 출금 완료
    checked_amount: bool = Field(default=False)  # 금액: 고지서 대조
    checklist_period: str | None = Field(default=None, max_length=10)
