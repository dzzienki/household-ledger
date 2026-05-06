from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.category import TransactionType
from app.models.recurring import RecurrenceFrequency


class RecurringCreate(BaseModel):
    category_id: UUID | None = None
    type: TransactionType
    amount: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    currency: str = Field(default="KRW", min_length=3, max_length=3)
    payee: str | None = Field(default=None, max_length=100)
    memo: str | None = Field(default=None, max_length=500)
    frequency: RecurrenceFrequency
    interval: int = Field(default=1, ge=1, le=999)
    start_date: date
    end_date: date | None = None


class RecurringUpdate(BaseModel):
    category_id: UUID | None = None
    amount: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=2)
    payee: str | None = Field(default=None, max_length=100)
    memo: str | None = Field(default=None, max_length=500)
    frequency: RecurrenceFrequency | None = None
    interval: int | None = Field(default=None, ge=1, le=999)
    end_date: date | None = None
    active: bool | None = None


class RecurringPublic(BaseModel):
    id: UUID
    ledger_id: UUID
    category_id: UUID | None
    type: TransactionType
    amount: Decimal
    currency: str
    payee: str | None
    memo: str | None
    frequency: RecurrenceFrequency
    interval: int
    start_date: date
    end_date: date | None
    next_due_date: date
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
