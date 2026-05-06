from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.models.ledger import LedgerRole, LedgerType


class LedgerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: LedgerType = LedgerType.PERSONAL
    currency: str = Field(default="KRW", min_length=3, max_length=3)


class LedgerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    currency: str | None = Field(default=None, min_length=3, max_length=3)


class LedgerPublic(BaseModel):
    id: UUID
    name: str
    type: LedgerType
    owner_id: UUID
    currency: str
    created_at: datetime

    model_config = {"from_attributes": True}


class LedgerInviteRequest(BaseModel):
    email: EmailStr
    role: LedgerRole = LedgerRole.EDITOR


class LedgerMemberPublic(BaseModel):
    user_id: UUID
    role: LedgerRole
    created_at: datetime

    model_config = {"from_attributes": True}


class LedgerMemberDetail(BaseModel):
    user_id: UUID
    email: EmailStr
    name: str
    role: LedgerRole
    created_at: datetime
