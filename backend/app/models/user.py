from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin, UUIDPKMixin


class User(UUIDPKMixin, TimestampMixin, SQLModel, table=True):
    __tablename__ = "users"

    email: str = Field(index=True, unique=True, max_length=255)
    name: str = Field(max_length=100)
    hashed_password: str = Field(max_length=255)
    is_active: bool = Field(default=True)
