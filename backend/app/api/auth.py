from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.api.deps import DbDep
from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.models import Ledger, LedgerMember, LedgerRole, LedgerType, User
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse
from app.schemas.user import UserPublic

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
