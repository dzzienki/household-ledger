import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlmodel import select

from app.api.deps import DbDep
from app.api.transactions import _to_public
from app.core.security import decode_token
from app.models import Category, Ledger, LedgerMember, LedgerRole, Transaction, User
from app.schemas.webhook import NotificationWebhookRequest, NotificationWebhookResponse
from app.services.notification_parser import parse_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ledgers/{ledger_id}/webhooks", tags=["webhooks"])


async def _resolve_webhook_user(
    ledger_id: UUID,
    db: DbDep,
    authorization: str | None = Header(default=None),
    token_param: str | None = Query(default=None, alias="token"),
    body_token: str | None = None,
) -> tuple[Ledger, LedgerMember, User]:
    """Authenticate webhook caller via Bearer header, URL query token, or body token."""
    raw_token = None
    if authorization and authorization.lower().startswith("bearer "):
        raw_token = authorization.split(" ", 1)[1].strip()
    elif token_param:
        raw_token = token_param.strip()
    elif body_token:
        raw_token = body_token.strip()

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token. Provide Bearer header, ?token query param, or 'token' in JSON body.",
        )

    try:
        payload = decode_token(raw_token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
        user_id_str = payload.get("sub")
        if not user_id_str:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")
        user_id = UUID(user_id_str)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    ledger = await db.get(Ledger, ledger_id)
    if not ledger:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ledger not found")

    membership = (
        await db.exec(
            select(LedgerMember).where(
                LedgerMember.ledger_id == ledger_id,
                LedgerMember.user_id == user.id,
            )
        )
    ).first()

    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this ledger")

    if membership.role not in [LedgerRole.OWNER, LedgerRole.EDITOR]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient ledger permissions")

    return ledger, membership, user


@router.post("/notification", response_model=NotificationWebhookResponse)
async def process_notification_webhook(
    ledger_id: UUID,
    payload: NotificationWebhookRequest,
    db: DbDep,
    authorization: Annotated[str | None, Header()] = None,
    token: Annotated[str | None, Query()] = None,
) -> NotificationWebhookResponse:
    """Receive push notifications (Toss, Toss Bank, etc.) or SMS from Android Tasker/MacroDroid

    and automatically record them as transactions in the ledger.
    """
    ledger, member, user = await _resolve_webhook_user(
        ledger_id=ledger_id,
        db=db,
        authorization=authorization,
        token_param=token,
        body_token=payload.token,
    )

    categories = list(
        (await db.exec(select(Category).where(Category.ledger_id == ledger.id))).all()
    )

    parsed = parse_notification(
        text=payload.text,
        sender=payload.sender,
        categories=categories,
    )

    if not parsed or not parsed.amount or parsed.amount <= 0:
        return NotificationWebhookResponse(
            success=False,
            parsed=False,
            message="알림 텍스트에서 결제 금액 또는 거래처를 인식할 수 없습니다.",
            transaction=None,
        )

    # Duplicate check: check if identical transaction was created in the last 3 minutes
    three_mins_ago = datetime.now(UTC) - timedelta(minutes=3)
    existing_dup = (
        await db.exec(
            select(Transaction).where(
                Transaction.ledger_id == ledger.id,
                Transaction.transaction_date == parsed.transaction_date,
                Transaction.amount == parsed.amount,
                Transaction.payee == parsed.payee,
                Transaction.created_at >= three_mins_ago,
            )
        )
    ).first()

    if existing_dup:
        return NotificationWebhookResponse(
            success=True,
            parsed=True,
            message=f"이미 등록된 거래내역입니다 (중복 방지: {parsed.payee} {int(parsed.amount):,}원).",
            transaction=_to_public(existing_dup, []),
        )

    cat_id = payload.category_id or parsed.suggested_category_id
    if cat_id:
        target_cat = await db.get(Category, cat_id)
        if not target_cat or target_cat.ledger_id != ledger.id or target_cat.type != parsed.type:
            cat_id = None

    new_txn = Transaction(
        ledger_id=ledger.id,
        created_by_id=user.id,
        type=parsed.type,
        amount=parsed.amount,
        currency=parsed.currency,
        transaction_date=parsed.transaction_date,
        payee=parsed.payee,
        memo=parsed.memo,
        category_id=cat_id,
    )
    db.add(new_txn)
    await db.commit()
    await db.refresh(new_txn)

    type_kr = "수입" if parsed.type.value == "income" else "지출"
    cat_info = f" [{parsed.suggested_category_name}]" if parsed.suggested_category_name else ""
    msg = f"{type_kr} {int(parsed.amount):,}원 '{parsed.payee}'{cat_info} 등록 완료 ({parsed.source})"

    return NotificationWebhookResponse(
        success=True,
        parsed=True,
        message=msg,
        transaction=_to_public(new_txn, []),
    )
