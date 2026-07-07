"""Helpers for converting transaction amounts into a ledger's base currency.

Rates are user-managed per ledger (see ExchangeRate). A transaction in the base
currency — or in a currency with no configured rate — is counted at 1:1.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import case, literal
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import ExchangeRate, Ledger, Transaction


async def converted_amount(db: AsyncSession, ledger: Ledger):
    """Return a SQL expression for Transaction.amount in the ledger base currency."""
    rates = list(
        (await db.exec(select(ExchangeRate).where(ExchangeRate.ledger_id == ledger.id))).all()
    )
    base = ledger.currency.upper()
    whens = [
        (Transaction.currency == r.currency, literal(r.rate_to_base))
        for r in rates
        if r.currency.upper() != base
    ]
    if not whens:
        return Transaction.amount
    return Transaction.amount * case(*whens, else_=literal(Decimal(1)))
