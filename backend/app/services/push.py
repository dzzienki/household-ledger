import asyncio
import base64
import json
import logging
from uuid import UUID

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.models import AppSetting, PushSubscription

logger = logging.getLogger(__name__)

_PRIVATE_KEY = "vapid_private_pem"
_PUBLIC_KEY = "vapid_public_b64"

_cache: dict[str, str] | None = None


async def get_vapid_keys(db: AsyncSession) -> dict[str, str]:
    """Return the VAPID key pair, generating and persisting it on first use.

    The insert is ON CONFLICT DO NOTHING followed by a re-read, so several
    workers racing on first boot all end up using the same stored pair."""
    global _cache
    if _cache:
        return _cache

    async def read() -> dict[str, str] | None:
        rows = (await db.exec(select(AppSetting).where(AppSetting.key.in_([_PRIVATE_KEY, _PUBLIC_KEY])))).all()
        found = {r.key: r.value for r in rows}
        if _PRIVATE_KEY in found and _PUBLIC_KEY in found:
            return {"private_pem": found[_PRIVATE_KEY], "public_b64": found[_PUBLIC_KEY]}
        return None

    keys = await read()
    if keys is None:
        vapid = Vapid()
        vapid.generate_keys()
        raw_pub = vapid.public_key.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
        stmt = pg_insert(AppSetting).values(
            [
                {"key": _PRIVATE_KEY, "value": vapid.private_pem().decode("utf-8")},
                {"key": _PUBLIC_KEY, "value": base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode("utf-8")},
            ]
        )
        await db.execute(stmt.on_conflict_do_nothing(index_elements=["key"]))
        await db.commit()
        keys = await read()
    assert keys is not None
    _cache = keys
    return keys


def _send_one(sub_info: dict, payload: str, private_pem: str) -> int | None:
    """Blocking send. Returns None on success, else the HTTP status (0 if unknown)."""
    try:
        webpush(
            subscription_info=sub_info,
            data=payload,
            # from_pem avoids pywebpush mis-parsing a full PEM string as raw base64.
            vapid_private_key=Vapid.from_pem(private_pem.encode("utf-8")),
            vapid_claims={"sub": settings.VAPID_SUBJECT},
        )
        return None
    except WebPushException as exc:
        logger.warning("web push failed: %s", exc)
        return exc.response.status_code if exc.response is not None else 0
    except Exception:
        logger.exception("web push error")
        return 0


async def send_push_to_user(
    db: AsyncSession, user_id: UUID, title: str, body: str, url: str, tag: str
) -> int:
    """Send a notification to every device the user subscribed. Returns the
    number delivered. Subscriptions the push service reports gone (404/410) are
    deleted."""
    subs = list((await db.exec(select(PushSubscription).where(PushSubscription.user_id == user_id))).all())
    if not subs:
        return 0

    keys = await get_vapid_keys(db)
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag}, ensure_ascii=False)

    delivered = 0
    for sub in subs:
        info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        status = await asyncio.to_thread(_send_one, info, payload, keys["private_pem"])
        if status is None:
            delivered += 1
        elif status in (404, 410):
            await db.delete(sub)
    await db.commit()
    return delivered
