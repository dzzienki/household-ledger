from typing import Annotated

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from app.api.deps import CurrentUser, DbDep
from app.core.config import settings
from app.models import PushSubscription
from app.services.push import get_vapid_keys, send_push_to_user

router = APIRouter(prefix="/push", tags=["push"])


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(max_length=255)
    auth: str = Field(max_length=255)


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: SubscriptionKeys


class UnsubscribeRequest(BaseModel):
    endpoint: str


class PushSettings(BaseModel):
    subscribed_devices: int
    notify_days_before: int = Field(ge=0, le=7)
    notify_hour: int = Field(ge=0, le=23)


class PushSettingsUpdate(BaseModel):
    notify_days_before: int | None = Field(default=None, ge=0, le=7)
    notify_hour: int | None = Field(default=None, ge=0, le=23)


async def _device_count(db, user_id) -> int:
    return (
        await db.exec(select(func.count()).select_from(PushSubscription).where(PushSubscription.user_id == user_id))
    ).one()


@router.get("/vapid-public-key")
async def vapid_public_key(db: DbDep) -> dict[str, str]:
    return {"public_key": (await get_vapid_keys(db))["public_b64"]}


@router.post("/subscribe", status_code=204)
async def subscribe(
    payload: SubscribeRequest,
    db: DbDep,
    user: CurrentUser,
    user_agent: Annotated[str, Header()] = "",
) -> None:
    existing = (
        await db.exec(select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint))
    ).first()
    if existing is None:
        existing = PushSubscription(user_id=user.id, endpoint=payload.endpoint, p256dh="", auth="")
    # A browser can re-subscribe with a new endpoint on the same device; keep the
    # list tidy by dropping this user's older entries from the same user agent.
    if user_agent:
        stale = (
            await db.exec(
                select(PushSubscription).where(
                    PushSubscription.user_id == user.id,
                    PushSubscription.user_agent == user_agent[:500],
                    PushSubscription.endpoint != payload.endpoint,
                )
            )
        ).all()
        for row in stale:
            await db.delete(row)
    existing.user_id = user.id  # endpoint may previously have belonged to another account on this device
    existing.p256dh = payload.keys.p256dh
    existing.auth = payload.keys.auth
    existing.user_agent = user_agent[:500]
    db.add(existing)
    await db.commit()


@router.post("/unsubscribe", status_code=204)
async def unsubscribe(payload: UnsubscribeRequest, db: DbDep, user: CurrentUser) -> None:
    sub = (
        await db.exec(
            select(PushSubscription).where(
                PushSubscription.endpoint == payload.endpoint, PushSubscription.user_id == user.id
            )
        )
    ).first()
    if sub is not None:
        await db.delete(sub)
        await db.commit()


@router.get("/settings", response_model=PushSettings)
async def get_settings(db: DbDep, user: CurrentUser) -> PushSettings:
    return PushSettings(
        subscribed_devices=await _device_count(db, user.id),
        notify_days_before=user.notify_days_before,
        notify_hour=user.notify_hour,
    )


@router.patch("/settings", response_model=PushSettings)
async def update_settings(payload: PushSettingsUpdate, db: DbDep, user: CurrentUser) -> PushSettings:
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(user, key, value)
    db.add(user)
    await db.commit()
    return PushSettings(
        subscribed_devices=await _device_count(db, user.id),
        notify_days_before=user.notify_days_before,
        notify_hour=user.notify_hour,
    )


@router.post("/test")
async def send_test(db: DbDep, user: CurrentUser) -> dict[str, int]:
    delivered = await send_push_to_user(
        db,
        user.id,
        "🔔 알림 테스트",
        "푸시 알림이 정상적으로 도착했습니다.",
        f"{settings.FRONTEND_BASE_PATH}/",
        "test",
    )
    if delivered == 0:
        raise HTTPException(status_code=400, detail="No push subscription found for this account")
    return {"delivered": delivered}
