from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin
from app.models.ledger import LedgerRole


class LedgerInvitation(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    __tablename__ = "ledger_invitations"

    ledger_id: UUID = Field(foreign_key="ledgers.id", index=True, ondelete="CASCADE")
    code: str = Field(index=True, unique=True, max_length=32)
    role: LedgerRole = Field(default=LedgerRole.EDITOR)
    created_by_id: UUID = Field(foreign_key="users.id")
    expires_at: datetime | None = Field(default=None)
    use_count: int = Field(default=0)
    max_uses: int | None = Field(default=None)
    is_active: bool = Field(default=True)
