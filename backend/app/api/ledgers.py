from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from app.api.deps import CurrentUser, DbDep, get_ledger_membership, require_role
from app.models import Ledger, LedgerMember, LedgerRole, User
from app.schemas.ledger import (
    LedgerCreate,
    LedgerInviteRequest,
    LedgerMemberPublic,
    LedgerPublic,
    LedgerUpdate,
)

router = APIRouter(prefix="/ledgers", tags=["ledgers"])

OwnerOrEditor = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)
OwnerOnly = require_role(LedgerRole.OWNER)


@router.get("", response_model=list[LedgerPublic])
async def list_my_ledgers(db: DbDep, current_user: CurrentUser) -> list[Ledger]:
    stmt = (
        select(Ledger)
        .join(LedgerMember, LedgerMember.ledger_id == Ledger.id)
        .where(LedgerMember.user_id == current_user.id)
        .order_by(Ledger.created_at)
    )
    return list((await db.exec(stmt)).all())


@router.post("", response_model=LedgerPublic, status_code=status.HTTP_201_CREATED)
async def create_ledger(
    payload: LedgerCreate, db: DbDep, current_user: CurrentUser
) -> Ledger:
    ledger = Ledger(
        name=payload.name,
        type=payload.type,
        currency=payload.currency,
        owner_id=current_user.id,
    )
    db.add(ledger)
    await db.flush()
    db.add(LedgerMember(ledger_id=ledger.id, user_id=current_user.id, role=LedgerRole.OWNER))
    await db.commit()
    await db.refresh(ledger)
    return ledger


@router.get("/{ledger_id}", response_model=LedgerPublic)
async def get_ledger(
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> Ledger:
    ledger, _ = membership
    return ledger


@router.patch("/{ledger_id}", response_model=LedgerPublic)
async def update_ledger(
    payload: LedgerUpdate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(OwnerOnly)],
) -> Ledger:
    ledger, _ = membership
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(ledger, key, value)
    db.add(ledger)
    await db.commit()
    await db.refresh(ledger)
    return ledger


@router.delete("/{ledger_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ledger(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(OwnerOnly)],
) -> None:
    ledger, _ = membership
    await db.delete(ledger)
    await db.commit()


@router.get("/{ledger_id}/members", response_model=list[LedgerMemberPublic])
async def list_members(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> list[LedgerMember]:
    ledger, _ = membership
    stmt = select(LedgerMember).where(LedgerMember.ledger_id == ledger.id)
    return list((await db.exec(stmt)).all())


@router.post("/{ledger_id}/members", response_model=LedgerMemberPublic, status_code=status.HTTP_201_CREATED)
async def invite_member(
    payload: LedgerInviteRequest,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(OwnerOnly)],
) -> LedgerMember:
    ledger, _ = membership
    invitee = (await db.exec(select(User).where(User.email == payload.email))).first()
    if invitee is None:
        raise HTTPException(status_code=404, detail="User with that email not found")

    existing = (
        await db.exec(
            select(LedgerMember).where(
                LedgerMember.ledger_id == ledger.id,
                LedgerMember.user_id == invitee.id,
            )
        )
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User is already a member")

    member = LedgerMember(ledger_id=ledger.id, user_id=invitee.id, role=payload.role)
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


@router.delete("/{ledger_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(OwnerOnly)],
) -> None:
    ledger, _ = membership
    if user_id == ledger.owner_id:
        raise HTTPException(status_code=400, detail="Cannot remove the owner")

    target = (
        await db.exec(
            select(LedgerMember).where(
                LedgerMember.ledger_id == ledger.id,
                LedgerMember.user_id == user_id,
            )
        )
    ).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Member not found")

    await db.delete(target)
    await db.commit()
