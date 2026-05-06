from enum import Enum
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin


class LedgerType(str, Enum):
    PERSONAL = "personal"
    SHARED = "shared"


class LedgerRole(str, Enum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class Ledger(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    __tablename__ = "ledgers"

    name: str = Field(max_length=100)
    type: LedgerType = Field(default=LedgerType.PERSONAL)
    owner_id: UUID = Field(foreign_key="users.id", index=True)
    currency: str = Field(default="KRW", max_length=3)


class LedgerMember(TimestampMixin, SQLModel, table=True):
    __tablename__ = "ledger_members"

    ledger_id: UUID = Field(foreign_key="ledgers.id", primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", primary_key=True)
    role: LedgerRole = Field(default=LedgerRole.EDITOR)
