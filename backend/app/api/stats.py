from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, extract, func, literal
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership
from app.models import Category, Ledger, LedgerMember, Transaction
from app.models.category import TransactionType
from app.schemas.stats import CategoryTotal, MonthlyTotal

router = APIRouter(prefix="/ledgers/{ledger_id}/stats", tags=["stats"])


@router.get("/monthly", response_model=list[MonthlyTotal])
async def monthly_totals(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    year: int | None = None,
) -> list[MonthlyTotal]:
    ledger, _ = membership
    target_year = year or datetime.now().year

    income_sum = func.coalesce(
        func.sum(case((Transaction.type == TransactionType.INCOME, Transaction.amount), else_=0)),
        0,
    )
    expense_sum = func.coalesce(
        func.sum(case((Transaction.type == TransactionType.EXPENSE, Transaction.amount), else_=0)),
        0,
    )
    month_col = extract("month", Transaction.transaction_date).label("month")

    stmt = (
        select(month_col, income_sum.label("income"), expense_sum.label("expense"))
        .where(
            Transaction.ledger_id == ledger.id,
            extract("year", Transaction.transaction_date) == target_year,
        )
        .group_by(month_col)
        .order_by(month_col)
    )
    rows = (await db.execute(stmt)).all()
    by_month = {int(r.month): (Decimal(r.income), Decimal(r.expense)) for r in rows}

    return [
        MonthlyTotal(
            year=target_year,
            month=m,
            income=by_month.get(m, (Decimal(0), Decimal(0)))[0],
            expense=by_month.get(m, (Decimal(0), Decimal(0)))[1],
        )
        for m in range(1, 13)
    ]


@router.get("/categories", response_model=list[CategoryTotal])
async def category_totals(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    type: TransactionType = Query(default=TransactionType.EXPENSE),
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[CategoryTotal]:
    ledger, _ = membership

    today = date.today()
    if end_date is None:
        end_date = today
    if start_date is None:
        start_date = today.replace(day=1)

    total_amount = func.sum(Transaction.amount).label("total")
    count_col = func.count(Transaction.id).label("count")

    stmt = (
        select(
            Transaction.category_id,
            func.coalesce(Category.name, literal("미분류")).label("name"),
            func.coalesce(Category.color, literal("#9CA3AF")).label("color"),
            total_amount,
            count_col,
        )
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .where(
            Transaction.ledger_id == ledger.id,
            Transaction.type == type,
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
        )
        .group_by(Transaction.category_id, Category.name, Category.color)
        .order_by(total_amount.desc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        CategoryTotal(
            category_id=r.category_id,
            category_name=r.name,
            color=r.color,
            type=type.value,
            total=Decimal(r.total or 0),
            count=int(r.count),
        )
        for r in rows
    ]
