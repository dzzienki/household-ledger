from decimal import Decimal

from pydantic import BaseModel, Field


class ExchangeRateUpsert(BaseModel):
    currency: str = Field(min_length=3, max_length=3)
    rate_to_base: Decimal = Field(gt=0, max_digits=18, decimal_places=8)


class ExchangeRatePublic(BaseModel):
    currency: str
    rate_to_base: Decimal

    model_config = {"from_attributes": True}
