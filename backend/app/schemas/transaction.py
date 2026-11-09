from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_serializer

from app.models.category import TransactionType
from app.schemas.tag import TagPublic
from app.schemas.transaction_item import TransactionItemCreate, TransactionItemPublic


class TransactionCreate(BaseModel):
    category_id: UUID | None = None
    type: TransactionType
    amount: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    currency: str = Field(default="KRW", min_length=3, max_length=3)
    transaction_date: date
    payee: str | None = Field(default=None, max_length=100)
    memo: str | None = Field(default=None, max_length=500)
    tag_ids: list[UUID] = Field(default_factory=list)
    items: list[TransactionItemCreate] = Field(default_factory=list)


class TransactionUpdate(BaseModel):
    category_id: UUID | None = None
    type: TransactionType | None = None
    amount: Decimal | None = Field(default=None, gt=0, max_digits=15, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    transaction_date: date | None = None
    payee: str | None = Field(default=None, max_length=100)
    memo: str | None = Field(default=None, max_length=500)
    tag_ids: list[UUID] | None = None
    items: list[TransactionItemCreate] | None = None


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
    tags: list[TagPublic] = Field(default_factory=list)
    items: list[TransactionItemPublic] = Field(default_factory=list)
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("amount", when_used="json")
    def serialize_amount(self, v: Decimal) -> int | float:
        if v == v.to_integral():
            return int(v)
        return float(v)


class BulkDeleteResponse(BaseModel):
    deleted_count: int
    message: str


class BatchCategorizeResponse(BaseModel):
    total_processed: int
    categorized_count: int
    rules_count: int
    ai_count: int
    remaining_count: int
    removed_transfers_count: int = 0
    message: str


class InternalTransferItem(BaseModel):
    id: UUID
    type: TransactionType
    amount: Decimal
    transaction_date: date
    payee: str | None
    memo: str | None


class InternalTransferPair(BaseModel):
    pair_id: str
    date: date
    amount: Decimal
    description: str
    expense_txn: InternalTransferItem
    income_txn: InternalTransferItem


class InternalTransferListResponse(BaseModel):
    pairs: list[InternalTransferPair]
    total_count: int
    total_amount: Decimal


class InternalTransferResolveRequest(BaseModel):
    transaction_ids: list[UUID] | None = None
    pair_ids: list[str] | None = None
    delete_all_detected: bool = False


class InternalTransferResolveResponse(BaseModel):
    deleted_count: int
    freed_amount: Decimal
    message: str


