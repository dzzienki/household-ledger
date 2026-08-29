from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlmodel import func, select

from app.api.deps import DbDep, get_ledger_membership
from app.models import Ledger, LedgerMember, Transaction, TransactionItem
from app.schemas.transaction_item import (
    ItemGroupSummary,
    ItemPriceHistoryEntry,
    ItemPriceHistoryResponse,
    ItemPriceStats,
)

router = APIRouter(prefix="/ledgers/{ledger_id}/items", tags=["items"])


@router.get("/history", response_model=ItemPriceHistoryResponse)
async def get_item_price_history(
    ledger_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    q: Annotated[str, Query(min_length=1, max_length=100, description="Item name or group query (e.g., '양파', '라면')")],
    item_group: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(le=200)] = 50,
) -> ItemPriceHistoryResponse:
    ledger, _ = membership
    search_term = q.strip()
    pattern = f"%{search_term}%"

    stmt = (
        select(TransactionItem, Transaction)
        .join(Transaction, Transaction.id == TransactionItem.transaction_id)
        .where(TransactionItem.ledger_id == ledger.id)
    )

    if item_group:
        stmt = stmt.where(TransactionItem.item_group == item_group.strip())
    else:
        stmt = stmt.where(
            (TransactionItem.name.ilike(pattern))
            | (TransactionItem.item_group.ilike(pattern))
        )

    stmt = stmt.order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc()).limit(limit)
    rows = list((await db.exec(stmt)).all())

    history_entries: list[ItemPriceHistoryEntry] = []
    unit_prices: list[Decimal] = []

    for item, txn in rows:
        # 단가 계산: unit_price가 명시되어 있으면 사용, 없으면 total_price / quantity
        effective_unit_price = item.unit_price
        if effective_unit_price is None and item.quantity and item.quantity > 0:
            effective_unit_price = round(item.total_price / item.quantity, 2)

        if effective_unit_price is not None:
            unit_prices.append(effective_unit_price)

        history_entries.append(
            ItemPriceHistoryEntry(
                id=item.id,
                transaction_id=txn.id,
                transaction_date=txn.transaction_date,
                payee=txn.payee,
                name=item.name,
                item_group=item.item_group,
                quantity=item.quantity,
                unit_price=effective_unit_price,
                total_price=item.total_price,
                currency=txn.currency,
                memo=item.memo,
            )
        )

    # 통계 계산
    latest_unit_price = unit_prices[0] if unit_prices else None
    latest_date = history_entries[0].transaction_date if history_entries else None
    latest_payee = history_entries[0].payee if history_entries else None
    min_unit_price = min(unit_prices) if unit_prices else None
    max_unit_price = max(unit_prices) if unit_prices else None
    avg_unit_price = round(sum(unit_prices) / len(unit_prices), 2) if unit_prices else None

    stats = ItemPriceStats(
        query=search_term,
        count=len(history_entries),
        latest_unit_price=latest_unit_price,
        latest_date=latest_date,
        latest_payee=latest_payee,
        min_unit_price=min_unit_price,
        max_unit_price=max_unit_price,
        avg_unit_price=avg_unit_price,
        currency=ledger.currency,
    )

    return ItemPriceHistoryResponse(stats=stats, history=history_entries)


@router.get("/groups", response_model=list[ItemGroupSummary])
async def list_item_groups(
    ledger_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> list[ItemGroupSummary]:
    ledger, _ = membership

    stmt = (
        select(
            TransactionItem.item_group,
            func.count(TransactionItem.id).label("item_count"),
            func.max(Transaction.transaction_date).label("latest_date"),
        )
        .join(Transaction, Transaction.id == TransactionItem.transaction_id)
        .where(
            TransactionItem.ledger_id == ledger.id,
            TransactionItem.item_group.is_not(None),
            TransactionItem.item_group != "",
        )
        .group_by(TransactionItem.item_group)
        .order_by(func.max(Transaction.transaction_date).desc())
    )

    rows = (await db.exec(stmt)).all()
    return [
        ItemGroupSummary(
            item_group=group,
            item_count=count,
            latest_date=latest,
        )
        for group, count, latest in rows
        if group
    ]
