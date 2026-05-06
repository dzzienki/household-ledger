from enum import Enum
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin


class TransactionType(str, Enum):
    INCOME = "income"
    EXPENSE = "expense"


class Category(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    __tablename__ = "categories"

    ledger_id: UUID = Field(foreign_key="ledgers.id", index=True)
    name: str = Field(max_length=50)
    type: TransactionType
    color: str = Field(default="#6B7280", max_length=7)
    icon: str | None = Field(default=None, max_length=50)
    sort_order: int = Field(default=0)
