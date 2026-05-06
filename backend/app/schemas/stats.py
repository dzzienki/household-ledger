from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel


class MonthlyTotal(BaseModel):
    year: int
    month: int
    income: Decimal
    expense: Decimal


class CategoryTotal(BaseModel):
    category_id: UUID | None
    category_name: str
    color: str
    type: str
    total: Decimal
    count: int


class StatsRange(BaseModel):
    start_date: date
    end_date: date
