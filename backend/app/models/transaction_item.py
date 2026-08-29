from decimal import Decimal
from uuid import UUID

from sqlalchemy import Column, Numeric
from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin


class TransactionItem(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    __tablename__ = "transaction_items"

    transaction_id: UUID = Field(foreign_key="transactions.id", index=True, ondelete="CASCADE")
    ledger_id: UUID = Field(foreign_key="ledgers.id", index=True)

    name: str = Field(max_length=200)  # 실제 품목명 (예: "신라면 5개입", "국내산 햇양파 1.5kg")
    item_group: str | None = Field(default=None, max_length=100, index=True)  # 대표 품목 그룹 (예: "라면", "양파")
    quantity: Decimal = Field(default=Decimal("1.0"), sa_column=Column(Numeric(10, 2), nullable=False))
    unit_price: Decimal | None = Field(default=None, sa_column=Column(Numeric(15, 2), nullable=True))
    total_price: Decimal = Field(sa_column=Column(Numeric(15, 2), nullable=False))
    memo: str | None = Field(default=None, max_length=200)
