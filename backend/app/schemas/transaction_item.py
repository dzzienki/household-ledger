from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class TransactionItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    item_group: str | None = Field(default=None, max_length=100)
    quantity: Decimal = Field(default=Decimal("1.0"), gt=0, max_digits=10, decimal_places=2)
    unit_price: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=2)
    total_price: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    memo: str | None = Field(default=None, max_length=200)


class TransactionItemUpdate(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=1, max_length=200)
    item_group: str | None = Field(default=None, max_length=100)
    quantity: Decimal = Field(default=Decimal("1.0"), gt=0, max_digits=10, decimal_places=2)
    unit_price: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=2)
    total_price: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    memo: str | None = Field(default=None, max_length=200)


class TransactionItemPublic(BaseModel):
    id: UUID
    transaction_id: UUID
    ledger_id: UUID
    name: str
    item_group: str | None
    quantity: Decimal
    unit_price: Decimal | None
    total_price: Decimal
    memo: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ItemPriceHistoryEntry(BaseModel):
    id: UUID
    transaction_id: UUID
    transaction_date: date
    payee: str | None
    name: str
    item_group: str | None
    quantity: Decimal
    unit_price: Decimal | None
    total_price: Decimal
    currency: str
    memo: str | None


class ItemPriceStats(BaseModel):
    query: str
    count: int
    latest_unit_price: Decimal | None
    latest_date: date | None
    latest_payee: str | None
    min_unit_price: Decimal | None
    max_unit_price: Decimal | None
    avg_unit_price: Decimal | None
    currency: str


class ItemPriceHistoryResponse(BaseModel):
    stats: ItemPriceStats
    history: list[ItemPriceHistoryEntry]


class ItemGroupSummary(BaseModel):
    item_group: str
    item_count: int
    latest_date: date | None
