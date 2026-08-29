from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.category import TransactionType


class StatementItemPreview(BaseModel):
    transaction_date: date
    payee: str = Field(min_length=1, max_length=200)
    amount: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    type: TransactionType = TransactionType.EXPENSE
    currency: str = Field(default="KRW", max_length=3)
    memo: str | None = Field(default=None, max_length=500)
    category_id: UUID | None = None
    category_name: str | None = None
    card_name: str | None = None
    approval_no: str | None = None
    is_duplicate: bool = False
    is_selected: bool = True


class StatementParseResponse(BaseModel):
    card_company: str | None
    total_count: int
    total_amount: Decimal
    requires_password: bool = False
    error_message: str | None = None
    items: list[StatementItemPreview]


class StatementImportRequest(BaseModel):
    items: list[StatementItemPreview]


class StatementImportResponse(BaseModel):
    imported_count: int
    total_amount: Decimal
