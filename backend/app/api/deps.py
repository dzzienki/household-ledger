from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models import Ledger, LedgerMember, LedgerRole, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DbDep,
    token: Annotated[str, Depends(oauth2_scheme)],
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise credentials_exception
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = UUID(user_id_str)
    except (ValueError, KeyError):
        raise credentials_exception from None

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_exception
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_ledger_membership(
    ledger_id: UUID,
    db: DbDep,
    current_user: CurrentUser,
) -> tuple[Ledger, LedgerMember]:
    ledger = await db.get(Ledger, ledger_id)
    if ledger is None:
        raise HTTPException(status_code=404, detail="Ledger not found")

    stmt = select(LedgerMember).where(
        LedgerMember.ledger_id == ledger_id,
        LedgerMember.user_id == current_user.id,
    )
    result = await db.exec(stmt)
    membership = result.first()
    if membership is None:
        raise HTTPException(status_code=403, detail="Not a member of this ledger")
    return ledger, membership


def require_role(*allowed: LedgerRole):
    async def checker(
        membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    ) -> tuple[Ledger, LedgerMember]:
        _, member = membership
        if member.role not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return membership

    return checker
