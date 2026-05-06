from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import Category, Ledger, LedgerMember, LedgerRole
from app.schemas.category import CategoryCreate, CategoryPublic, CategoryUpdate

router = APIRouter(prefix="/ledgers/{ledger_id}/categories", tags=["categories"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)


@router.get("", response_model=list[CategoryPublic])
async def list_categories(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> list[Category]:
    ledger, _ = membership
    stmt = (
        select(Category)
        .where(Category.ledger_id == ledger.id)
        .order_by(Category.sort_order, Category.name)
    )
    return list((await db.exec(stmt)).all())


@router.post("", response_model=CategoryPublic, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> Category:
    ledger, _ = membership
    category = Category(ledger_id=ledger.id, **payload.model_dump())
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.patch("/{category_id}", response_model=CategoryPublic)
async def update_category(
    category_id: UUID,
    payload: CategoryUpdate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> Category:
    ledger, _ = membership
    category = await db.get(Category, category_id)
    if category is None or category.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Category not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, key, value)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> None:
    ledger, _ = membership
    category = await db.get(Category, category_id)
    if category is None or category.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.delete(category)
    await db.commit()
