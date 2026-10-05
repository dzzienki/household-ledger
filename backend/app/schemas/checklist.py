from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.category import TransactionType
from app.models.recurring import RecurrenceFrequency


class ChecklistItem(BaseModel):
    recurring_id: UUID
    category_id: UUID | None
    type: TransactionType
    title: str | None
    payee: str | None
    memo: str | None
    amount: Decimal
    currency: str
    frequency: RecurrenceFrequency
    due_date: date | None
    checked_funded: bool
    checked_paid: bool
    checked_amount: bool
    done: bool


class ChecklistMonth(BaseModel):
    period: str
    items: list[ChecklistItem]
    total: int
    completed: int
    in_progress: int
    pending: int


class ChecklistUpdate(BaseModel):
    period: str | None = Field(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    checked_funded: bool | None = None
    checked_paid: bool | None = None
    checked_amount: bool | None = None
