from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Column, Numeric
from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin
from app.models.category import TransactionType


class DismissedTransaction(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    """Fingerprint of a transaction the user removed on purpose (e.g. an internal transfer).

    Re-importing an overlapping statement period must not bring these back, so the statement
    preview treats a matching row like an existing duplicate.
    """

    __tablename__ = "dismissed_transactions"

    ledger_id: UUID = Field(foreign_key="ledgers.id", index=True, ondelete="CASCADE")
    type: TransactionType
    amount: Decimal = Field(sa_column=Column(Numeric(15, 2), nullable=False))
    transaction_date: date = Field(index=True)
    # Running balance after the transaction ("잔액" in bank exports), when known.
    balance: Decimal | None = Field(default=None, sa_column=Column(Numeric(15, 2), nullable=True))
    payee: str | None = Field(default=None, max_length=100)
    reason: str = Field(default="internal_transfer", max_length=30)
