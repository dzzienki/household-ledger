from decimal import Decimal
from uuid import UUID

from sqlalchemy import Column, Numeric
from sqlmodel import Field, SQLModel

from app.models.base import TimestampMixin


class ExchangeRate(TimestampMixin, SQLModel, table=True):
    """A user-managed conversion rate from `currency` into the ledger's base currency.

    `rate_to_base` means: 1 unit of `currency` == rate_to_base units of the ledger
    base currency. The base currency itself is implicitly 1 and is not stored.
    """

    __tablename__ = "exchange_rates"

    ledger_id: UUID = Field(foreign_key="ledgers.id", primary_key=True)
    currency: str = Field(primary_key=True, max_length=3)
    rate_to_base: Decimal = Field(sa_column=Column(Numeric(18, 8), nullable=False))
