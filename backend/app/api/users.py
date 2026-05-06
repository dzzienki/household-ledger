from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.models import User
from app.schemas.user import UserPublic

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserPublic)
async def me(current_user: CurrentUser) -> User:
    return current_user
