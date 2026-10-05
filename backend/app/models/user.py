from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin


class User(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    __tablename__ = "users"

    email: str = Field(index=True, unique=True, max_length=255)
    name: str = Field(max_length=100)
    hashed_password: str = Field(max_length=255)
    is_active: bool = Field(default=True)

    # Push reminder preferences. Reminders go out at notify_hour (KST) on the day
    # that is notify_days_before days ahead of a due date.
    notify_days_before: int = Field(default=1)
    notify_hour: int = Field(default=9)
