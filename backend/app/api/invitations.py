import secrets
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from app.api.deps import CurrentUser, DbDep, require_role
from app.models import Ledger, LedgerInvitation, LedgerMember, LedgerRole, User
from app.schemas.invitation import (
    InvitationAcceptResponse,
    InvitationCreate,
    InvitationInfo,
    InvitationPublic,
)

router = APIRouter(tags=["invitations"])

OwnerOnly = require_role(LedgerRole.OWNER)
OwnerOrEditor = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)


def _generate_invite_code() -> str:
    return secrets.token_urlsafe(12)


@router.get("/ledgers/{ledger_id}/invitation", response_model=InvitationPublic)
async def get_or_create_ledger_invitation(
    db: DbDep,
    current_user: CurrentUser,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(OwnerOrEditor)],
) -> LedgerInvitation:
    ledger, _ = membership
    stmt = (
        select(LedgerInvitation)
        .where(
            LedgerInvitation.ledger_id == ledger.id,
            LedgerInvitation.is_active == True,  # noqa: E712
        )
        .order_by(LedgerInvitation.created_at.desc())
    )
    inv = (await db.exec(stmt)).first()
    if inv is not None:
        return inv

    # Create default active invitation
    inv = LedgerInvitation(
        ledger_id=ledger.id,
        code=_generate_invite_code(),
        role=LedgerRole.EDITOR,
        created_by_id=current_user.id,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return inv


@router.post("/ledgers/{ledger_id}/invitation", response_model=InvitationPublic, status_code=status.HTTP_201_CREATED)
async def create_new_ledger_invitation(
    payload: InvitationCreate,
    db: DbDep,
    current_user: CurrentUser,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(OwnerOnly)],
) -> LedgerInvitation:
    ledger, _ = membership

    # Deactivate previous invitations for this ledger
    stmt = select(LedgerInvitation).where(
        LedgerInvitation.ledger_id == ledger.id,
        LedgerInvitation.is_active == True,  # noqa: E712
    )
    existing_list = list((await db.exec(stmt)).all())
    for item in existing_list:
        item.is_active = False
        db.add(item)

    inv = LedgerInvitation(
        ledger_id=ledger.id,
        code=_generate_invite_code(),
        role=payload.role,
        created_by_id=current_user.id,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return inv


@router.delete("/ledgers/{ledger_id}/invitation/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_ledger_invitation(
    code: str,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(OwnerOnly)],
) -> None:
    ledger, _ = membership
    stmt = select(LedgerInvitation).where(
        LedgerInvitation.ledger_id == ledger.id,
        LedgerInvitation.code == code,
    )
    inv = (await db.exec(stmt)).first()
    if inv is not None:
        inv.is_active = False
        db.add(inv)
        await db.commit()


@router.get("/invitations/{code}", response_model=InvitationInfo)
async def get_invitation_info(code: str, db: DbDep) -> InvitationInfo:
    stmt = select(LedgerInvitation).where(LedgerInvitation.code == code)
    inv = (await db.exec(stmt)).first()
    if inv is None or not inv.is_active:
        raise HTTPException(status_code=404, detail="유효하지 않거나 만료된 초대 링크입니다")

    if inv.expires_at is not None and inv.expires_at < datetime.now():
        raise HTTPException(status_code=410, detail="만료된 초대 링크입니다")

    if inv.max_uses is not None and inv.use_count >= inv.max_uses:
        raise HTTPException(status_code=410, detail="초대 링크 사용 인원 한도를 초과했습니다")

    ledger = await db.get(Ledger, inv.ledger_id)
    if ledger is None:
        raise HTTPException(status_code=404, detail="가계부를 찾을 수 없습니다")

    inviter = await db.get(User, inv.created_by_id)
    inviter_name = inviter.name if inviter else "멤버"

    return InvitationInfo(
        code=inv.code,
        ledger_id=ledger.id,
        ledger_name=ledger.name,
        ledger_type=ledger.type.value,
        inviter_name=inviter_name,
        role=inv.role,
        is_valid=True,
    )


@router.post("/invitations/{code}/accept", response_model=InvitationAcceptResponse)
async def accept_invitation(code: str, db: DbDep, current_user: CurrentUser) -> InvitationAcceptResponse:
    stmt = select(LedgerInvitation).where(LedgerInvitation.code == code)
    inv = (await db.exec(stmt)).first()
    if inv is None or not inv.is_active:
        raise HTTPException(status_code=404, detail="유효하지 않거나 만료된 초대 링크입니다")

    if inv.expires_at is not None and inv.expires_at < datetime.now():
        raise HTTPException(status_code=410, detail="만료된 초대 링크입니다")

    if inv.max_uses is not None and inv.use_count >= inv.max_uses:
        raise HTTPException(status_code=410, detail="초대 링크 사용 인원 한도를 초과했습니다")

    ledger = await db.get(Ledger, inv.ledger_id)
    if ledger is None:
        raise HTTPException(status_code=404, detail="가계부를 찾을 수 없습니다")

    # Check if already a member
    member_stmt = select(LedgerMember).where(
        LedgerMember.ledger_id == ledger.id,
        LedgerMember.user_id == current_user.id,
    )
    existing_member = (await db.exec(member_stmt)).first()
    if existing_member is not None:
        return InvitationAcceptResponse(
            ledger_id=ledger.id,
            ledger_name=ledger.name,
            role=existing_member.role,
            already_member=True,
        )

    new_member = LedgerMember(
        ledger_id=ledger.id,
        user_id=current_user.id,
        role=inv.role,
    )
    db.add(new_member)
    inv.use_count += 1
    db.add(inv)
    await db.commit()

    return InvitationAcceptResponse(
        ledger_id=ledger.id,
        ledger_name=ledger.name,
        role=inv.role,
        already_member=False,
    )
