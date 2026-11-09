from uuid import UUID
from pydantic import BaseModel, Field

from app.schemas.transaction import TransactionPublic


class NotificationWebhookRequest(BaseModel):
    text: str = Field(..., description="Raw push notification or SMS text message")
    sender: str | None = Field(default=None, description="Sender name or app identifier e.g. 토스, 토스뱅크, 신한카드")
    token: str | None = Field(default=None, description="Optional access token for direct webhook integration without header")
    category_id: UUID | None = Field(default=None, description="Optional explicit category ID override")


class NotificationWebhookResponse(BaseModel):
    success: bool
    parsed: bool
    message: str
    transaction: TransactionPublic | None = None
