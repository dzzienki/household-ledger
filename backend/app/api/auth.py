from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.api.deps import CurrentUser, DbDep
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models import Ledger, LedgerMember, LedgerRole, LedgerType, User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    SignupRequest,
    TokenResponse,
)
from app.schemas.user import UserPublic
from app.services.categories import seed_default_categories

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest, db: DbDep) -> User:
    existing = (await db.exec(select(User).where(User.email == payload.email))).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        name=payload.name,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    await db.flush()

    personal = Ledger(
        name=f"{payload.name}의 개인 가계부",
        type=LedgerType.PERSONAL,
        owner_id=user.id,
    )
    db.add(personal)
    await db.flush()

    db.add(LedgerMember(ledger_id=personal.id, user_id=user.id, role=LedgerRole.OWNER))
    await seed_default_categories(db, personal.id)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: DbDep) -> TokenResponse:
    user = (await db.exec(select(User).where(User.email == payload.email))).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, db: DbDep) -> TokenResponse:
    try:
        data = decode_token(payload.refresh_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    if data.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    sub = data.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    try:
        user_id = UUID(sub)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid user ID in token")

    user = (await db.exec(select(User).where(User.id == user_id))).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUser,
    db: DbDep,
) -> dict[str, str]:
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="현재 비밀번호가 일치하지 않습니다.",
        )
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="새 비밀번호는 현재 비밀번호와 달라야 합니다.",
        )

    current_user.hashed_password = hash_password(payload.new_password)
    db.add(current_user)
    await db.commit()
    return {"message": "비밀번호가 성공적으로 변경되었습니다."}

