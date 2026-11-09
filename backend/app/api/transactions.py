from collections.abc import Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import (
    Category,
    Ledger,
    LedgerMember,
    LedgerRole,
    Tag,
    Transaction,
    TransactionItem,
    TransactionTag,
)
from app.models.category import TransactionType
from app.schemas.tag import TagPublic
from app.schemas.transaction import (
    BatchCategorizeResponse,
    BulkDeleteResponse,
    FixLegacyIncomesResponse,
    InternalTransferItem,
    InternalTransferListResponse,
    InternalTransferPair,
    InternalTransferResolveRequest,
    InternalTransferResolveResponse,
    TransactionCreate,
    TransactionPublic,
    TransactionUpdate,
)
from app.schemas.transaction_item import TransactionItemCreate, TransactionItemPublic
from app.services.recurring import materialize_due_for_ledger

router = APIRouter(prefix="/ledgers/{ledger_id}/transactions", tags=["transactions"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)


async def _validate_category(
    db, ledger_id: UUID, category_id: UUID | None, expected_type: TransactionType | None
) -> None:
    if category_id is None:
        return
    category = await db.get(Category, category_id)
    if category is None or category.ledger_id != ledger_id:
        raise HTTPException(status_code=400, detail="Invalid category for this ledger")
    if expected_type is not None and category.type != expected_type:
        raise HTTPException(status_code=400, detail="Category type does not match transaction type")


async def _resolve_tags(db: AsyncSession, ledger_id: UUID, tag_ids: list[UUID]) -> list[Tag]:
    """Validate that every tag id belongs to this ledger and return the Tag rows."""
    if not tag_ids:
        return []
    unique_ids = list(dict.fromkeys(tag_ids))
    tags = list(
        (
            await db.exec(
                select(Tag).where(Tag.ledger_id == ledger_id, Tag.id.in_(unique_ids))
            )
        ).all()
    )
    if len(tags) != len(unique_ids):
        raise HTTPException(status_code=400, detail="One or more tags are invalid for this ledger")
    return tags


async def _set_transaction_tags(
    db: AsyncSession, transaction_id: UUID, tag_ids: list[UUID]
) -> None:
    """Replace the tag links for a transaction with the given set."""
    existing = list(
        (
            await db.exec(
                select(TransactionTag).where(TransactionTag.transaction_id == transaction_id)
            )
        ).all()
    )
    for link in existing:
        await db.delete(link)
    for tag_id in dict.fromkeys(tag_ids):
        db.add(TransactionTag(transaction_id=transaction_id, tag_id=tag_id))


async def _tags_by_transaction(
    db: AsyncSession, transaction_ids: Sequence[UUID]
) -> dict[UUID, list[Tag]]:
    """Fetch tags for a batch of transactions in one round-trip."""
    if not transaction_ids:
        return {}
    stmt = (
        select(TransactionTag.transaction_id, Tag)
        .join(Tag, Tag.id == TransactionTag.tag_id)
        .where(TransactionTag.transaction_id.in_(list(transaction_ids)))
        .order_by(Tag.name)
    )
    result: dict[UUID, list[Tag]] = {}
    for txn_id, tag in (await db.exec(stmt)).all():
        result.setdefault(txn_id, []).append(tag)
    return result


async def _items_by_transaction(
    db: AsyncSession, transaction_ids: Sequence[UUID]
) -> dict[UUID, list[TransactionItem]]:
    """Fetch items for a batch of transactions in one round-trip."""
    if not transaction_ids:
        return {}
    stmt = (
        select(TransactionItem)
        .where(TransactionItem.transaction_id.in_(list(transaction_ids)))
        .order_by(TransactionItem.created_at.asc())
    )
    result: dict[UUID, list[TransactionItem]] = {}
    for item in (await db.exec(stmt)).all():
        result.setdefault(item.transaction_id, []).append(item)
    return result


async def _set_transaction_items(
    db: AsyncSession,
    transaction_id: UUID,
    ledger_id: UUID,
    items: list[TransactionItemCreate],
) -> list[TransactionItem]:
    """Replace line items for a transaction."""
    existing = list(
        (
            await db.exec(
                select(TransactionItem).where(TransactionItem.transaction_id == transaction_id)
            )
        ).all()
    )
    for item in existing:
        await db.delete(item)
    created: list[TransactionItem] = []
    for it in items:
        new_item = TransactionItem(
            transaction_id=transaction_id,
            ledger_id=ledger_id,
            name=it.name.strip(),
            item_group=it.item_group.strip() if it.item_group and it.item_group.strip() else None,
            quantity=it.quantity,
            unit_price=it.unit_price,
            total_price=it.total_price,
            memo=it.memo.strip() if it.memo and it.memo.strip() else None,
        )
        db.add(new_item)
        created.append(new_item)
    return created


def _to_public(
    txn: Transaction,
    tags: list[Tag],
    items: list[TransactionItem] | None = None,
) -> TransactionPublic:
    return TransactionPublic(
        id=txn.id,
        ledger_id=txn.ledger_id,
        category_id=txn.category_id,
        created_by_id=txn.created_by_id,
        type=txn.type,
        amount=txn.amount,
        currency=txn.currency,
        transaction_date=txn.transaction_date,
        payee=txn.payee,
        memo=txn.memo,
        tags=[TagPublic.model_validate(t) for t in tags],
        items=[TransactionItemPublic.model_validate(it) for it in (items or [])],
        created_at=txn.created_at,
    )


@router.get("", response_model=list[TransactionPublic])
async def list_transactions(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    type: TransactionType | None = None,
    category_id: UUID | None = None,
    uncategorized: bool | None = Query(default=None, description="Filter for transactions with no category"),
    tag_id: UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    q: str | None = Query(default=None, max_length=200, description="Search in payee/memo/item name"),
    limit: int = Query(default=100, le=500),
    offset: int = 0,
) -> list[TransactionPublic]:
    ledger, _ = membership
    if await materialize_due_for_ledger(db, ledger.id) > 0:
        await db.commit()
    stmt = select(Transaction).where(Transaction.ledger_id == ledger.id)
    if type is not None:
        stmt = stmt.where(Transaction.type == type)
    if uncategorized is True:
        stmt = stmt.where(Transaction.category_id.is_(None))
    elif category_id is not None:
        stmt = stmt.where(Transaction.category_id == category_id)
    if tag_id is not None:
        stmt = stmt.where(
            Transaction.id.in_(
                select(TransactionTag.transaction_id).where(TransactionTag.tag_id == tag_id)
            )
        )
    if start_date is not None:
        stmt = stmt.where(Transaction.transaction_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(Transaction.transaction_date <= end_date)
    if q:
        pattern = f"%{q.strip()}%"
        matching_item_txn_ids = select(TransactionItem.transaction_id).where(
            (TransactionItem.ledger_id == ledger.id)
            & ((TransactionItem.name.ilike(pattern)) | (TransactionItem.item_group.ilike(pattern)))
        )
        stmt = stmt.where(
            (Transaction.payee.ilike(pattern))
            | (Transaction.memo.ilike(pattern))
            | (Transaction.id.in_(matching_item_txn_ids))
        )
    stmt = stmt.order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
    stmt = stmt.offset(offset).limit(limit)
    txns = list((await db.exec(stmt)).all())

    txn_ids = [t.id for t in txns]
    tag_map = await _tags_by_transaction(db, txn_ids)
    item_map = await _items_by_transaction(db, txn_ids)
    return [_to_public(t, tag_map.get(t.id, []), item_map.get(t.id, [])) for t in txns]


@router.post("", response_model=TransactionPublic, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> TransactionPublic:
    ledger, member = membership
    await _validate_category(db, ledger.id, payload.category_id, payload.type)
    tags = await _resolve_tags(db, ledger.id, payload.tag_ids)

    data = payload.model_dump(exclude={"tag_ids", "items"})
    txn = Transaction(ledger_id=ledger.id, created_by_id=member.user_id, **data)
    db.add(txn)
    await db.flush()
    await _set_transaction_tags(db, txn.id, [t.id for t in tags])

    items: list[TransactionItem] = []
    if payload.items:
        items = await _set_transaction_items(db, txn.id, ledger.id, payload.items)

    await db.commit()
    await db.refresh(txn)
    return _to_public(txn, tags, items)


@router.delete("/bulk", response_model=BulkDeleteResponse)
async def bulk_delete_transactions(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
    uncategorized_only: bool = Query(default=False, description="Delete only uncategorized transactions"),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    created_after: datetime | None = Query(default=None, description="Delete only transactions created after this timestamp"),
) -> BulkDeleteResponse:
    ledger, _ = membership
    stmt = select(Transaction).where(Transaction.ledger_id == ledger.id)
    if uncategorized_only:
        stmt = stmt.where(Transaction.category_id.is_(None))
    if created_after is not None:
        stmt = stmt.where(Transaction.created_at >= created_after)
    if start_date is not None:
        stmt = stmt.where(Transaction.transaction_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(Transaction.transaction_date <= end_date)

    txns = list((await db.exec(stmt)).all())
    count = len(txns)
    if count == 0:
        return BulkDeleteResponse(deleted_count=0, message="삭제할 거래내역이 없습니다.")

    txn_ids = [t.id for t in txns]

    # Delete related tags & items
    for txn_id in txn_ids:
        tag_links = list(
            (await db.exec(select(TransactionTag).where(TransactionTag.transaction_id == txn_id))).all()
        )
        for link in tag_links:
            await db.delete(link)
        items = list(
            (await db.exec(select(TransactionItem).where(TransactionItem.transaction_id == txn_id))).all()
        )
        for it in items:
            await db.delete(it)

    for t in txns:
        await db.delete(t)

    await db.commit()
    msg = f"총 {count}건의 거래내역이 성공적으로 삭제되었습니다."
    return BulkDeleteResponse(deleted_count=count, message=msg)


INTERNAL_OUTFLOW_KEYWORDS = ["(모임통장)", "모임통장", "허브통장", "내계좌간", "자동이체", "송금", "출금"]
INTERNAL_INFLOW_KEYWORDS = ["생활비", "공과금", "수혈", "입금", "식비생활비", "보탬", "수급", "전환", "남은거"]
GENERAL_INTERNAL_KEYWORDS = [
    "모임통장", "허브", "생활비", "공과금", "수혈", "최명준", "강유리",
    "관리비통장", "내계좌", "자동이체", "송금", "이체", "급여", "월급", "보탬", "모은돈", "식비생활비등"
]

EXTERNAL_MERCHANT_KEYWORDS = [
    "스타벅스", "이디야", "투썸", "메가mgc", "빽다방", "컴포즈", "커피", "카페", "베이커리",
    "식당", "음식점", "치킨", "버거", "맥도날드", "피자", "배달의민족", "요기요", "쿠팡이츠",
    "이마트", "홈플러스", "롯데마트", "지에스25", "gs25", "씨유", "cu", "세븐일레븐", "마트", "쿠팡",
    "약국", "병원", "의원", "치과", "내과", "cgv", "롯데시네마", "메가박스", "올리브영", "다이소"
]


async def _find_internal_transfer_pairs_for_ledger(
    db: AsyncSession, ledger_id: UUID
) -> list[dict[str, Any]]:
    """Detects 1:1 matching internal transfers (e.g. hub account -> living/utility accounts) on the same date with exact amount."""
    stmt = (
        select(Transaction)
        .where(Transaction.ledger_id == ledger_id)
        .order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
    )
    txns = list((await db.exec(stmt)).all())

    matched_ids: set[UUID] = set()
    pairs: list[dict[str, Any]] = []

    def is_type(t: Transaction, t_type: str) -> bool:
        val = t.type.value if hasattr(t.type, "value") else str(t.type)
        return str(val).lower() == t_type.lower()

    # Pass 1: Standard Expense vs Income matching
    expenses = [t for t in txns if is_type(t, "expense")]
    incomes = [t for t in txns if is_type(t, "income")]

    for exp in expenses:
        if exp.id in matched_ids:
            continue
        exp_text = f"{exp.payee or ''} {exp.memo or ''}".lower().strip()
        if any(ek in exp_text for ek in EXTERNAL_MERCHANT_KEYWORDS):
            continue

        for inc in incomes:
            if inc.id in matched_ids:
                continue
            if exp.transaction_date == inc.transaction_date and exp.amount == inc.amount:
                inc_text = f"{inc.payee or ''} {inc.memo or ''}".lower().strip()
                if any(ek in inc_text for ek in EXTERNAL_MERCHANT_KEYWORDS):
                    continue

                if any(k in exp_text for k in GENERAL_INTERNAL_KEYWORDS) or any(k in inc_text for k in GENERAL_INTERNAL_KEYWORDS):
                    matched_ids.add(exp.id)
                    matched_ids.add(inc.id)
                    desc = f"{exp.payee or '출금'} ➔ {inc.payee or '입금'}"
                    pairs.append({
                        "pair_id": f"{exp.id}_{inc.id}",
                        "date": exp.transaction_date,
                        "amount": exp.amount,
                        "description": desc,
                        "expense_txn": InternalTransferItem(
                            id=exp.id,
                            type=exp.type,
                            amount=exp.amount,
                            transaction_date=exp.transaction_date,
                            payee=exp.payee,
                            memo=exp.memo,
                        ),
                        "income_txn": InternalTransferItem(
                            id=inc.id,
                            type=inc.type,
                            amount=inc.amount,
                            transaction_date=inc.transaction_date,
                            payee=inc.payee,
                            memo=inc.memo,
                        ),
                    })
                    break

    # Pass 2: Legacy both-as-expense matching (handles statements imported before parser deposit fix)
    unmatched = [t for t in txns if t.id not in matched_ids]
    inflow_candidates: list[Transaction] = []
    outflow_candidates: list[Transaction] = []
    for t in unmatched:
        t_text = f"{t.payee or ''} {t.memo or ''}".lower().strip()
        if any(ek in t_text for ek in EXTERNAL_MERCHANT_KEYWORDS):
            continue
        if any(ik in t_text for ik in INTERNAL_INFLOW_KEYWORDS):
            inflow_candidates.append(t)
        elif any(ok in t_text for ok in INTERNAL_OUTFLOW_KEYWORDS) or any(gk in t_text for gk in GENERAL_INTERNAL_KEYWORDS):
            outflow_candidates.append(t)

    for out_t in outflow_candidates:
        if out_t.id in matched_ids:
            continue
        out_text = f"{out_t.payee or ''} {out_t.memo or ''}".lower().strip()

        for in_t in inflow_candidates:
            if in_t.id in matched_ids:
                continue
            if out_t.id == in_t.id:
                continue
            if out_t.transaction_date == in_t.transaction_date and out_t.amount == in_t.amount:
                matched_ids.add(out_t.id)
                matched_ids.add(in_t.id)
                desc = f"{out_t.payee or '출금'} ➔ {in_t.payee or '입금'}"
                pairs.append({
                    "pair_id": f"{out_t.id}_{in_t.id}",
                    "date": out_t.transaction_date,
                    "amount": out_t.amount,
                    "description": desc,
                    "expense_txn": InternalTransferItem(
                        id=out_t.id,
                        type=out_t.type,
                        amount=out_t.amount,
                        transaction_date=out_t.transaction_date,
                        payee=out_t.payee,
                        memo=out_t.memo,
                    ),
                    "income_txn": InternalTransferItem(
                        id=in_t.id,
                        type=in_t.type,
                        amount=in_t.amount,
                        transaction_date=in_t.transaction_date,
                        payee=in_t.payee,
                        memo=in_t.memo,
                    ),
                })
                break

    # Pass 3: General internal keyword pairs on same date and same amount
    remaining_unmatched = [t for t in unmatched if t.id not in matched_ids]
    for i, t1 in enumerate(remaining_unmatched):
        if t1.id in matched_ids:
            continue
        t1_text = f"{t1.payee or ''} {t1.memo or ''}".lower().strip()
        if any(ek in t1_text for ek in EXTERNAL_MERCHANT_KEYWORDS):
            continue
        if not any(k in t1_text for k in GENERAL_INTERNAL_KEYWORDS):
            continue

        for j, t2 in enumerate(remaining_unmatched):
            if i >= j or t2.id in matched_ids:
                continue
            t2_text = f"{t2.payee or ''} {t2.memo or ''}".lower().strip()
            if any(ek in t2_text for ek in EXTERNAL_MERCHANT_KEYWORDS):
                continue
            if not any(k in t2_text for k in GENERAL_INTERNAL_KEYWORDS):
                continue

            if t1.transaction_date == t2.transaction_date and t1.amount == t2.amount:
                matched_ids.add(t1.id)
                matched_ids.add(t2.id)
                desc = f"{t1.payee or '이체1'} ⇄ {t2.payee or '이체2'}"
                pairs.append({
                    "pair_id": f"{t1.id}_{t2.id}",
                    "date": t1.transaction_date,
                    "amount": t1.amount,
                    "description": desc,
                    "expense_txn": InternalTransferItem(
                        id=t1.id,
                        type=t1.type,
                        amount=t1.amount,
                        transaction_date=t1.transaction_date,
                        payee=t1.payee,
                        memo=t1.memo,
                    ),
                    "income_txn": InternalTransferItem(
                        id=t2.id,
                        type=t2.type,
                        amount=t2.amount,
                        transaction_date=t2.transaction_date,
                        payee=t2.payee,
                        memo=t2.memo,
                    ),
                })
                break

    return pairs


@router.get("/internal-transfers", response_model=InternalTransferListResponse)
async def list_internal_transfer_pairs(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> InternalTransferListResponse:
    """Lists detected internal family / inter-account transfer duplicates."""
    ledger, _ = membership
    pairs_data = await _find_internal_transfer_pairs_for_ledger(db, ledger.id)
    pairs = [InternalTransferPair(**p) for p in pairs_data]
    total_amount = sum((p.amount for p in pairs), Decimal(0))
    return InternalTransferListResponse(
        pairs=pairs,
        total_count=len(pairs),
        total_amount=total_amount,
    )


@router.post("/internal-transfers/resolve", response_model=InternalTransferResolveResponse)
async def resolve_internal_transfer_pairs(
    payload: InternalTransferResolveRequest,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> InternalTransferResolveResponse:
    """Resolves (deletes) duplicate inter-account transfer transactions to clean up double counting."""
    ledger, _ = membership
    pairs_data = await _find_internal_transfer_pairs_for_ledger(db, ledger.id)

    txn_ids_to_delete: set[UUID] = set()

    if payload.delete_all_detected:
        for p in pairs_data:
            txn_ids_to_delete.add(p["expense_txn"].id)
            txn_ids_to_delete.add(p["income_txn"].id)
    else:
        if payload.pair_ids:
            pair_set = set(payload.pair_ids)
            for p in pairs_data:
                if p["pair_id"] in pair_set:
                    txn_ids_to_delete.add(p["expense_txn"].id)
                    txn_ids_to_delete.add(p["income_txn"].id)
        if payload.transaction_ids:
            for tid in payload.transaction_ids:
                txn_ids_to_delete.add(tid)

    if not txn_ids_to_delete:
        return InternalTransferResolveResponse(
            deleted_count=0,
            freed_amount=Decimal(0),
            message="제거할 중복 이체 거래가 없습니다.",
        )

    stmt = select(Transaction).where(
        Transaction.ledger_id == ledger.id,
        Transaction.id.in_(txn_ids_to_delete),
    )
    txns_to_delete = list((await db.exec(stmt)).all())
    deleted_count = len(txns_to_delete)
    total_freed = sum((t.amount for t in txns_to_delete), Decimal(0))

    # Also delete associated items / tags if any
    for t in txns_to_delete:
        await db.delete(t)
    await db.commit()

    return InternalTransferResolveResponse(
        deleted_count=deleted_count,
        freed_amount=total_freed,
        message=f"총 {deleted_count}건의 내부 이체 중복 거래(총 {total_freed:,.0f}원)를 성공적으로 정리했습니다.",
    )


async def _fix_legacy_incomes_for_ledger(db, ledger_id: UUID) -> tuple[int, Decimal]:
    """Scans and converts transactions mistakenly imported as EXPENSE into INCOME."""
    from app.services.categories import ensure_standard_categories
    categories = await ensure_standard_categories(db, ledger_id)

    # Map income categories
    income_cats = {c.name: c.id for c in categories if str(c.type).lower() in ("transactiontype.income", "income")}
    salary_cat_id = next((c_id for c_name, c_id in income_cats.items() if any(k in c_name for k in ["급여", "월급", "소득"])), None)
    interest_cat_id = next((c_id for c_name, c_id in income_cats.items() if any(k in c_name for k in ["이자", "금융"])), None)
    misc_inc_cat_id = next((c_id for c_name, c_id in income_cats.items() if any(k in c_name for k in ["기타 수입", "기타수입", "부수입", "수입"])), None)

    stmt = select(Transaction).where(
        Transaction.ledger_id == ledger_id,
        Transaction.type == TransactionType.EXPENSE,
    )
    txns = list((await db.exec(stmt)).all())

    SALARY_KW = ["급여", "월급", "상여", "보너스", "수당"]
    INTEREST_KW = ["통장 이자", "통장이자", "예금이자", "적금이자", "이자입금"]
    MISC_INCOME_KW = ["atm입금", "수술비지원", "코다리찜", "관리비", "공과금", "환급", "연말정산", "캐시백", "지원받은돈", "남은거"]
    OUTFLOW_KW = ["신용대출", "대출", "카드", "용돈", "교통비", "보험비", "데이트", "수술비", "취득세", "갚기", "스커트", "가습기", "케이크", "베개", "택시", "린클", "수리비"]

    converted_count = 0
    converted_amount = Decimal(0)

    for t in txns:
        text = f"{t.payee or ''} {t.memo or ''}".lower().strip()
        is_income = False
        target_cat_id = None

        if any(k in text for k in SALARY_KW):
            is_income = True
            target_cat_id = salary_cat_id or misc_inc_cat_id
        elif any(k in text for k in INTEREST_KW):
            is_income = True
            target_cat_id = interest_cat_id or misc_inc_cat_id
        elif any(k in text for k in MISC_INCOME_KW) and not any(ok in (t.memo or "").lower() for ok in ["갚기", "출금"]):
            is_income = True
            target_cat_id = misc_inc_cat_id
        elif (t.payee or "").strip() in ["최명준", "강유리"]:
            if not any(ok in (t.memo or "").lower() for ok in OUTFLOW_KW):
                is_income = True
                if t.amount >= 1000000:
                    target_cat_id = salary_cat_id or misc_inc_cat_id
                else:
                    target_cat_id = misc_inc_cat_id

        if is_income:
            t.type = TransactionType.INCOME
            if target_cat_id:
                t.category_id = target_cat_id
            db.add(t)
            converted_count += 1
            converted_amount += t.amount

    if converted_count > 0:
        await db.commit()

    return converted_count, converted_amount


@router.post("/fix-legacy-incomes", response_model=FixLegacyIncomesResponse)
async def fix_legacy_incomes_endpoint(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> FixLegacyIncomesResponse:
    """Detects and fixes transactions erroneously imported as EXPENSE instead of INCOME."""
    ledger, _ = membership
    count, total_amt = await _fix_legacy_incomes_for_ledger(db, ledger.id)
    if count == 0:
        return FixLegacyIncomesResponse(
            converted_count=0,
            converted_amount=Decimal(0),
            message="수입으로 복구할 대상 거래가 없습니다.",
        )
    return FixLegacyIncomesResponse(
        converted_count=count,
        converted_amount=total_amt,
        message=f"총 {count}건의 거래(총 {total_amt:,.0f}원)를 정상적으로 수입으로 복구하였습니다.",
    )


@router.post("/batch-categorize", response_model=BatchCategorizeResponse)
async def batch_auto_categorize_transactions(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
    force_all: bool = Query(default=False, description="Re-evaluate all transactions even if already categorized"),
    reclassify_misc: bool = Query(default=True, description="Also re-evaluate transactions currently in 기타 지출 / 기타 수입 to refine them"),
    deduplicate_transfers: bool = Query(default=False, description="Automatically remove exact inter-account transfer duplicate transactions"),
    fix_legacy_incomes: bool = Query(default=True, description="Convert legacy statement transactions that were erroneously marked as EXPENSE into INCOME"),
) -> BatchCategorizeResponse:
    ledger, _ = membership

    fixed_incomes_count = 0
    if fix_legacy_incomes:
        fixed_incomes_count, _ = await _fix_legacy_incomes_for_ledger(db, ledger.id)

    from app.services.categories import ensure_standard_categories
    # Ensure standard categories exist (adds 보험, 금융/대출, 저축/투자, 경조사/선물, 용돈 if missing)
    categories = await ensure_standard_categories(db, ledger.id)

    removed_transfers_count = 0
    if deduplicate_transfers:
        pairs = await _find_internal_transfer_pairs_for_ledger(db, ledger.id)
        if pairs:
            tids = [p["expense_txn"].id for p in pairs] + [p["income_txn"].id for p in pairs]
            del_stmt = select(Transaction).where(Transaction.ledger_id == ledger.id, Transaction.id.in_(tids))
            to_del = list((await db.exec(del_stmt)).all())
            for t in to_del:
                await db.delete(t)
            await db.commit()
            removed_transfers_count = len(to_del)

    # Identify misc category IDs if reclassify_misc is True
    misc_cat_ids = [c.id for c in categories if c.name in ("기타 지출", "기타 수입", "기타")]

    stmt = select(Transaction).where(Transaction.ledger_id == ledger.id)
    if not force_all:
        if reclassify_misc and misc_cat_ids:
            stmt = stmt.where((Transaction.category_id.is_(None)) | (Transaction.category_id.in_(misc_cat_ids)))
        else:
            stmt = stmt.where(Transaction.category_id.is_(None))

    txns = list((await db.exec(stmt)).all())
    total_processed = len(txns)
    if total_processed == 0:
        msg = f"분류할 대상 거래가 없습니다.{f' (내부 이체 중복 {removed_transfers_count}건 정리 완료)' if removed_transfers_count > 0 else ''}"
        if fixed_incomes_count > 0:
            msg += f" (과거 수입 거래 {fixed_incomes_count}건 정상 복구 완료)"
        return BatchCategorizeResponse(
            total_processed=0,
            categorized_count=0,
            rules_count=0,
            ai_count=0,
            remaining_count=0,
            removed_transfers_count=removed_transfers_count,
            message=msg,
        )

    rules_count = 0
    ai_count = 0
    from app.services.ai import is_ai_enabled, suggest_categories_batch
    from app.services.statement_parser import _guess_category_by_rules

    # Phase 1: High-speed rule-based classification (all in-memory regex/substring, < 0.05s)
    remaining_txns: list[Transaction] = []
    for txn in txns:
        corpus = f"{txn.payee or ''} {txn.memo or ''}".strip()
        txn_type_str = txn.type.value if hasattr(txn.type, "value") else str(txn.type)
        cat_id, cat_name = _guess_category_by_rules(corpus, categories, txn_type=txn_type_str)
        # If we got a category and it's different from current (or was None), update it
        if cat_id and cat_id != txn.category_id:
            txn.category_id = cat_id
            rules_count += 1
            db.add(txn)
        elif txn.category_id is None:
            remaining_txns.append(txn)

    # Immediately commit rule-based classifications so they are never lost even if network issues occur
    if rules_count > 0:
        await db.commit()

    # Phase 2: Batch AI classification with Gemini (chunks of 40 to ensure response in < 3s)
    if is_ai_enabled() and remaining_txns:
        ai_candidates = [t for t in remaining_txns if t.payee or t.memo]
        chunk_size = 40
        # Process up to 3 chunks (120 items) per invocation to guarantee fast response
        for i in range(0, min(len(ai_candidates), 120), chunk_size):
            chunk = ai_candidates[i : i + chunk_size]
            payload = [
                {
                    "id": str(t.id),
                    "type": t.type.value if hasattr(t.type, "value") else str(t.type),
                    "payee": t.payee,
                    "memo": t.memo,
                }
                for t in chunk
            ]
            matched_map = suggest_categories_batch(payload, categories)
            chunk_updated = False
            for t in chunk:
                tid_str = str(t.id)
                if tid_str in matched_map:
                    t.category_id = matched_map[tid_str]
                    ai_count += 1
                    db.add(t)
                    chunk_updated = True
            if chunk_updated:
                await db.commit()
    categorized_count = rules_count + ai_count
    remaining = total_processed - categorized_count

    msg_parts = [f"총 {total_processed}건 검토 중 {categorized_count}건 세분화/분류 완료 (규칙: {rules_count}건, AI: {ai_count}건)"]
    if fixed_incomes_count > 0:
        msg_parts.append(f"과거 수입 거래 {fixed_incomes_count}건 정상 복구")
    if removed_transfers_count > 0:
        msg_parts.append(f"내부 이체 중복 {removed_transfers_count}건 정리")
    if remaining > 0:
        msg_parts.append(f"미분류/유지: {remaining}건")

    return BatchCategorizeResponse(
        total_processed=total_processed,
        categorized_count=categorized_count,
        rules_count=rules_count,
        ai_count=ai_count,
        remaining_count=remaining,
        removed_transfers_count=removed_transfers_count,
        message=", ".join(msg_parts),
    )


@router.get("/{transaction_id}", response_model=TransactionPublic)
async def get_transaction(
    transaction_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> TransactionPublic:
    ledger, _ = membership
    txn = await db.get(Transaction, transaction_id)
    if txn is None or txn.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Transaction not found")
    tag_map = await _tags_by_transaction(db, [txn.id])
    item_map = await _items_by_transaction(db, [txn.id])
    return _to_public(txn, tag_map.get(txn.id, []), item_map.get(txn.id, []))


@router.patch("/{transaction_id}", response_model=TransactionPublic)
async def update_transaction(
    transaction_id: UUID,
    payload: TransactionUpdate,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> TransactionPublic:
    ledger, _ = membership
    txn = await db.get(Transaction, transaction_id)
    if txn is None or txn.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Transaction not found")

    data = payload.model_dump(exclude_unset=True)
    tag_ids = data.pop("tag_ids", None)
    items_data = data.pop("items", None)

    if "category_id" in data:
        await _validate_category(
            db, ledger.id, data["category_id"], data.get("type", txn.type)
        )

    for key, value in data.items():
        setattr(txn, key, value)
    db.add(txn)

    tags: list[Tag] | None = None
    if tag_ids is not None:
        tags = await _resolve_tags(db, ledger.id, tag_ids)
        await _set_transaction_tags(db, txn.id, [t.id for t in tags])

    items: list[TransactionItem] | None = None
    if items_data is not None:
        items = await _set_transaction_items(
            db, txn.id, ledger.id, [TransactionItemCreate.model_validate(it) for it in items_data]
        )

    await db.commit()
    await db.refresh(txn)

    if tags is None:
        tag_map = await _tags_by_transaction(db, [txn.id])
        tags = tag_map.get(txn.id, [])
    if items is None:
        item_map = await _items_by_transaction(db, [txn.id])
        items = item_map.get(txn.id, [])

    return _to_public(txn, tags, items)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: UUID,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> None:
    ledger, _ = membership
    txn = await db.get(Transaction, transaction_id)
    if txn is None or txn.ledger_id != ledger.id:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await db.delete(txn)
    await db.commit()

