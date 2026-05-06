from datetime import date
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import Budget, Category, Ledger, LedgerMember, LedgerRole, Transaction
from app.models.category import TransactionType
from app.schemas.budget import BudgetCreate, BudgetPublic, BudgetStatus, BudgetUpdate

router = APIRouter(prefix="/ledgers/{ledger_id}/budgets", tags=["budgets"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)


def _month_range(today: date | None = None) -> tuple[date, date]:
    today = today or date.today()
    start = today.replace(day=1)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


@router.get("", response_model=list[BudgetPublic])
async def list_budgets(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> list[Budget]:
    ledger, _ = membership
    stmt = select(Budget).where(Budget.ledger_id == ledger.id)
    return list((await db.exec(stmt)).all())


@router.get("/status", response_model=list[BudgetStatus])
async def budget_status(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> list[BudgetStatus]:
    ledger, _ = membership
    start, end = _month_range()

    budgets = list((await db.exec(select(Budget).where(Budget.ledger_id == ledger.id))).all())
    if not budgets:
        return []

    # Map category_id -> spent amount this month
    spend_stmt = (
        select(Transaction.category_id, func.coalesce(func.sum(Transaction.amount), 0))
        .where(
            Transaction.ledger_id == ledger.id,
            Transaction.type == TransactionType.EXPENSE,
            Transaction.transaction_date >= start,
            Transaction.transaction_date < end,
        )
        .group_by(Transaction.category_id)
    )
    spend_by_cat: dict[UUID | None, Decimal] = {}
    for cat_id, total in (await db.execute(spend_stmt)).all():
        spend_by_cat[cat_id] = Decimal(total)

    total_expense_stmt = (
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.ledger_id == ledger.id,
            Transaction.type == TransactionType.EXPENSE,
            Transaction.transaction_date >= start,
            Transaction.transaction_date < end,
        )
    )
    total_expense = Decimal((await db.execute(total_expense_stmt)).scalar() or 0)

    cat_ids = [b.category_id for b in budgets if b.category_id is not None]
    name_color: dict[UUID, tuple[str, str]] = {}
    if cat_ids:
        cat_stmt = select(Category).where(Category.id.in_(cat_ids))
        for c in (await db.exec(cat_stmt)).all():
            name_color[c.id] = (c.name, c.color)

    out: list[BudgetStatus] = []
    for b in budgets:
        if b.category_id is None:
            spent = total_expense
            cat_name, color = "전체 지출", "#1F2937"
        else:
            spent = spend_by_cat.get(b.category_id, Decimal(0))
            cat_name, color = name_color.get(b.category_id, ("(삭제됨)", "#9CA3AF"))

        amount = Decimal(b.amount)
        remaining = amount - spent
        percent = float((spent / amount) * 100) if amount > 0 else 0.0
        out.append(
            BudgetStatus(
                id=b.id,
                category_id=b.category_id,
                category_name=cat_name,
                color=color,
                amount=amount,
                spent=spent,
                remaining=remaining,
                percent=round(percent, 1),
                is_over=spent > amount,
            )
        )
    return out


@router.post("", response_model=BudgetPublic, status_code=status.HTTP_201_CREATED)
async def create_budget(
    payload: BudgetCreate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> Budget:
    ledger, _ = membership

    if payload.category_id is not None:
        cat = await db.get(Category, payload.category_id)
        if cat is None or cat.ledger_id != ledger.id:
            raise HTTPException(status_code=400, detail="Invalid category")
        if cat.type != TransactionType.EXPENSE:
            raise HTTPException(status_code=400, detail="Budgets only apply to expense categories")

    # Prevent duplicates per (ledger, category)
    existing = (
        await db.exec(
            select(Budget).where(
                Budget.ledger_id == ledger.id,
                Budget.category_id == payload.category_id,
            )
        )
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Budget already exists for this scope")

    budget = Budget(ledger_id=ledger.id, **payload.model_dump())
    db.add(budget)
    await db.commit()
    await db.refresh(budget)
    return budget


@router.patch("/{budget_id}", response_model=BudgetPublic)
async def update_budget(
    budget_id: UUID,
    payload: BudgetUpdate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> Budget:
    ledger, _ = membership
    budget = await db.get(Budget, budget_id)
    if budget is None or budget.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Budget not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(budget, key, value)
    db.add(budget)
    await db.commit()
    await db.refresh(budget)
    return budget


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    budget_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> None:
    ledger, _ = membership
    budget = await db.get(Budget, budget_id)
    if budget is None or budget.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Budget not found")
    await db.delete(budget)
    await db.commit()
