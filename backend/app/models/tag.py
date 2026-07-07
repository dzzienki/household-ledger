from uuid import UUID

from sqlmodel import Field, SQLModel, UniqueConstraint

from app.models.base import TimestampMixin, UUIDPKMixin


class Tag(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("ledger_id", "name", name="uq_tag_ledger_name"),)

    ledger_id: UUID = Field(foreign_key="ledgers.id", index=True)
    name: str = Field(max_length=30)
    color: str = Field(default="#6B7280", max_length=7)


class TransactionTag(SQLModel, table=True):
    __tablename__ = "transaction_tags"

    transaction_id: UUID = Field(
        foreign_key="transactions.id", primary_key=True, ondelete="CASCADE"
    )
    tag_id: UUID = Field(foreign_key="tags.id", primary_key=True, ondelete="CASCADE")
