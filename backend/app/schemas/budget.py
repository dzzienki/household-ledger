from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class BudgetCreate(BaseModel):
    category_id: UUID | None = None
    amount: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    currency: str = Field(default="KRW", min_length=3, max_length=3)
    memo: str | None = Field(default=None, max_length=100)


class BudgetUpdate(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=2)
    memo: str | None = Field(default=None, max_length=100)


class BudgetPublic(BaseModel):
    id: UUID
    ledger_id: UUID
    category_id: UUID | None
    amount: Decimal
    currency: str
    memo: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BudgetStatus(BaseModel):
    """Monthly status for one budget."""

    id: UUID
    category_id: UUID | None
    category_name: str
    color: str
    amount: Decimal
    spent: Decimal
    remaining: Decimal
    percent: float
    is_over: bool
    memo: str | None = None
