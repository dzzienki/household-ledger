from decimal import Decimal
from uuid import UUID

from sqlalchemy import Column, Numeric
from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin


class Budget(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    __tablename__ = "budgets"

    ledger_id: UUID = Field(foreign_key="ledgers.id", index=True)
    category_id: UUID | None = Field(default=None, foreign_key="categories.id", index=True)
    amount: Decimal = Field(sa_column=Column(Numeric(15, 2), nullable=False))
    currency: str = Field(default="KRW", max_length=3)
    memo: str | None = Field(default=None, max_length=100)
