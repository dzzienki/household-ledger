from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.ledger import LedgerRole


class InvitationCreate(BaseModel):
    role: LedgerRole = LedgerRole.EDITOR


class InvitationPublic(BaseModel):
    id: UUID
    ledger_id: UUID
    code: str
    role: LedgerRole
    created_by_id: UUID
    expires_at: datetime | None
    use_count: int
    max_uses: int | None
    is_active: bool
    created_at: datetime


class InvitationInfo(BaseModel):
    code: str
    ledger_id: UUID
    ledger_name: str
    ledger_type: str
    inviter_name: str
    role: LedgerRole
    is_valid: bool
    message: str | None = None


class InvitationAcceptResponse(BaseModel):
    ledger_id: UUID
    ledger_name: str
    role: LedgerRole
    already_member: bool = False
