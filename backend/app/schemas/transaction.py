from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.category import TransactionType


class TransactionCreate(BaseModel):
    category_id: UUID | None = None
    type: TransactionType
    amount: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    currency: str = Field(default="KRW", min_length=3, max_length=3)
    transaction_date: date
    payee: str | None = Field(default=None, max_length=100)
    memo: str | None = Field(default=None, max_length=500)


class TransactionUpdate(BaseModel):
    category_id: UUID | None = None
    type: TransactionType | None = None
    amount: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=2)
    transaction_date: date | None = None
    payee: str | None = Field(default=None, max_length=100)
    memo: str | None = Field(default=None, max_length=500)


class TransactionPublic(BaseModel):
    id: UUID
    ledger_id: UUID
    category_id: UUID | None
    created_by_id: UUID
    type: TransactionType
    amount: Decimal
    currency: str
    transaction_date: date
    payee: str | None
    memo: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
