from datetime import date
from uuid import UUID

from sqlalchemy import Column, ForeignKey, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin


class PushSubscription(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    """A browser Web Push subscription (one per user device)."""

    __tablename__ = "push_subscriptions"

    user_id: UUID = Field(sa_column=Column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True))
    endpoint: str = Field(sa_column=Column(Text, nullable=False, unique=True))
    p256dh: str = Field(max_length=255)
    auth: str = Field(max_length=255)
    user_agent: str = Field(default="", max_length=500)


class NotificationLog(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    """Dedupe record so each reminder is sent once, even with multiple workers."""

    __tablename__ = "notification_logs"
    __table_args__ = (
        UniqueConstraint("user_id", "recurring_id", "period", "kind", name="uq_notification_logs_dedupe"),
    )

    user_id: UUID = Field(sa_column=Column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True))
    recurring_id: UUID = Field(
        sa_column=Column(ForeignKey("recurring_transactions.id", ondelete="CASCADE"), nullable=False)
    )
    period: str = Field(sa_column=Column(String(7), nullable=False))
    kind: str = Field(sa_column=Column(String(16), nullable=False))  # upcoming | due | overdue
    due_date: date


class AppSetting(SQLModel, table=True):
    """Small server-side key/value store (holds the auto-generated VAPID keys)."""

    __tablename__ = "app_settings"

    key: str = Field(primary_key=True, max_length=64)
    value: str = Field(sa_column=Column(Text, nullable=False))
