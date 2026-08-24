from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, extract, func, literal
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership
from app.models import Category, Ledger, LedgerMember, Transaction
from app.models.category import TransactionType
from app.schemas.stats import CategoryTotal, LedgerSummary, MonthlyTotal
from app.services.currency import converted_amount
from app.services.recurring import materialize_due_for_ledger

router = APIRouter(prefix="/ledgers/{ledger_id}/stats", tags=["stats"])


@router.get("/monthly", response_model=list[MonthlyTotal])
async def monthly_totals(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    year: int | None = None,
) -> list[MonthlyTotal]:
    ledger, _ = membership
    if await materialize_due_for_ledger(db, ledger.id) > 0:
        await db.commit()
    target_year = year or datetime.now().year

    amount = await converted_amount(db, ledger)
    income_sum = func.coalesce(
        func.sum(case((Transaction.type == TransactionType.INCOME, amount), else_=0)),
        0,
    )
    expense_sum = func.coalesce(
        func.sum(case((Transaction.type == TransactionType.EXPENSE, amount), else_=0)),
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

    amount = await converted_amount(db, ledger)
    total_amount = func.sum(amount).label("total")
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


@router.get("/summary", response_model=LedgerSummary)
async def ledger_summary(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    start_date: date | None = None,
    end_date: date | None = None,
) -> LedgerSummary:
    ledger, _ = membership
    if await materialize_due_for_ledger(db, ledger.id) > 0:
        await db.commit()

    amount = await converted_amount(db, ledger)
    income_val = case((Transaction.type == TransactionType.INCOME, amount), else_=0)
    expense_val = case((Transaction.type == TransactionType.EXPENSE, amount), else_=0)

    # 1. All-time totals
    all_time_stmt = select(
        func.coalesce(func.sum(income_val), 0).label("income"),
        func.coalesce(func.sum(expense_val), 0).label("expense"),
    ).where(Transaction.ledger_id == ledger.id)
    all_time_row = (await db.execute(all_time_stmt)).first()
    all_time_income = Decimal(all_time_row.income) if all_time_row else Decimal(0)
    all_time_expense = Decimal(all_time_row.expense) if all_time_row else Decimal(0)
    all_time_balance = all_time_income - all_time_expense

    # 2. Carryover (before start_date)
    carryover_balance = Decimal(0)
    if start_date is not None:
        carryover_stmt = select(
            func.coalesce(func.sum(income_val), 0).label("income"),
            func.coalesce(func.sum(expense_val), 0).label("expense"),
        ).where(
            Transaction.ledger_id == ledger.id,
            Transaction.transaction_date < start_date,
        )
        carryover_row = (await db.execute(carryover_stmt)).first()
        carryover_income = Decimal(carryover_row.income) if carryover_row else Decimal(0)
        carryover_expense = Decimal(carryover_row.expense) if carryover_row else Decimal(0)
        carryover_balance = carryover_income - carryover_expense

    # 3. Period totals
    period_conditions = [Transaction.ledger_id == ledger.id]
    if start_date is not None:
        period_conditions.append(Transaction.transaction_date >= start_date)
    if end_date is not None:
        period_conditions.append(Transaction.transaction_date <= end_date)

    period_stmt = select(
        func.coalesce(func.sum(income_val), 0).label("income"),
        func.coalesce(func.sum(expense_val), 0).label("expense"),
    ).where(*period_conditions)
    period_row = (await db.execute(period_stmt)).first()
    period_income = Decimal(period_row.income) if period_row else Decimal(0)
    period_expense = Decimal(period_row.expense) if period_row else Decimal(0)
    period_net = period_income - period_expense

    # Final balance as of end of period
    if start_date is not None:
        final_balance = carryover_balance + period_net
    else:
        final_balance = all_time_balance

    return LedgerSummary(
        currency=ledger.currency,
        carryover_balance=carryover_balance,
        period_income=period_income,
        period_expense=period_expense,
        period_net=period_net,
        final_balance=final_balance,
        all_time_balance=all_time_balance,
    )

