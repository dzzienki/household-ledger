from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.category import TransactionType


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    type: TransactionType
    color: str = Field(default="#6B7280", pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: str | None = Field(default=None, max_length=50)
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: str | None = Field(default=None, max_length=50)
    sort_order: int | None = None


class CategoryPublic(BaseModel):
    id: UUID
    ledger_id: UUID
    name: str
    type: TransactionType
    color: str
    icon: str | None
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}
