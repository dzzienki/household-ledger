from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import ExchangeRate, Ledger, LedgerMember, LedgerRole
from app.schemas.exchange_rate import ExchangeRatePublic, ExchangeRateUpsert

router = APIRouter(prefix="/ledgers/{ledger_id}/exchange-rates", tags=["exchange-rates"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)


@router.get("", response_model=list[ExchangeRatePublic])
async def list_rates(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> list[ExchangeRate]:
    ledger, _ = membership
    stmt = (
        select(ExchangeRate)
        .where(ExchangeRate.ledger_id == ledger.id)
        .order_by(ExchangeRate.currency)
    )
    return list((await db.exec(stmt)).all())


@router.put("", response_model=ExchangeRatePublic)
async def upsert_rate(
    payload: ExchangeRateUpsert,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> ExchangeRate:
    ledger, _ = membership
    currency = payload.currency.upper()
    if currency == ledger.currency.upper():
        raise HTTPException(
            status_code=400,
            detail="Base currency always converts at 1 and cannot have a rate",
        )

    rate = await db.get(ExchangeRate, (ledger.id, currency))
    if rate is None:
        rate = ExchangeRate(
            ledger_id=ledger.id, currency=currency, rate_to_base=payload.rate_to_base
        )
    else:
        rate.rate_to_base = payload.rate_to_base
    db.add(rate)
    await db.commit()
    await db.refresh(rate)
    return rate


@router.delete("/{currency}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rate(
    currency: str,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> None:
    ledger, _ = membership
    rate = await db.get(ExchangeRate, (ledger.id, currency.upper()))
    if rate is None:
        raise HTTPException(status_code=404, detail="Exchange rate not found")
    await db.delete(rate)
    await db.commit()
