from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import Category, Ledger, LedgerMember, LedgerRole, Transaction
from app.models.category import TransactionType
from app.schemas.statement import (
    StatementImportRequest,
    StatementImportResponse,
    StatementItemPreview,
    StatementParseResponse,
)
from app.services.statement_parser import parse_statement_file

router = APIRouter(prefix="/ledgers/{ledger_id}/statements", tags=["statements"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)


@router.post("/parse", response_model=StatementParseResponse)
async def parse_statement(
    ledger_id: UUID,
    file: Annotated[UploadFile, File()],
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
    password: str | None = Form(default=None),
) -> StatementParseResponse:
    ledger, _ = membership

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")

    filename = file.filename or "statement.xlsx"
    content_type = file.content_type

    categories = list(
        (await db.exec(select(Category).where(Category.ledger_id == ledger.id))).all()
    )

    parsed = parse_statement_file(
        content=content,
        filename=filename,
        content_type=content_type,
        categories=categories,
        password=password,
    )

    if parsed.requires_password:
        return StatementParseResponse(
            card_company=parsed.card_company,
            total_count=0,
            total_amount=Decimal(0),
            requires_password=True,
            error_message=parsed.error_message,
            items=[],
        )

    # Fetch existing transactions for duplicate detection
    if parsed.items:
        min_date = min(it.transaction_date for it in parsed.items)
        max_date = max(it.transaction_date for it in parsed.items)
        min_d = datetime.strptime(min_date, "%Y-%m-%d").date()
        max_d = datetime.strptime(max_date, "%Y-%m-%d").date()

        existing_txns = list(
            (
                await db.exec(
                    select(Transaction).where(
                        Transaction.ledger_id == ledger.id,
                        Transaction.transaction_date >= min_d,
                        Transaction.transaction_date <= max_d,
                    )
                )
            ).all()
        )
        existing_signatures = {
            (t.transaction_date, (t.payee or "").strip(), Decimal(str(t.amount)))
            for t in existing_txns
        }
    else:
        existing_signatures = set()

    items: list[StatementItemPreview] = []
    for it in parsed.items:
        t_date = datetime.strptime(it.transaction_date, "%Y-%m-%d").date()
        t_amt = Decimal(str(round(it.amount, 2)))
        sig = (t_date, it.payee.strip(), t_amt)
        is_dup = sig in existing_signatures

        txn_type = TransactionType.INCOME if it.type == "income" else TransactionType.EXPENSE

        items.append(
            StatementItemPreview(
                transaction_date=t_date,
                payee=it.payee,
                amount=t_amt,
                type=txn_type,
                currency=it.currency,
                memo=it.memo,
                category_id=it.suggested_category_id,
                category_name=it.suggested_category_name,
                card_name=it.card_name,
                approval_no=it.approval_no,
                is_duplicate=is_dup,
                is_selected=not is_dup,  # Default uncheck duplicates
            )
        )

    return StatementParseResponse(
        card_company=parsed.card_company,
        total_count=len(items),
        total_amount=Decimal(str(parsed.total_amount)),
        requires_password=False,
        error_message=None,
        items=items,
    )


@router.post("/import", response_model=StatementImportResponse, status_code=status.HTTP_201_CREATED)
async def import_statements(
    ledger_id: UUID,
    payload: StatementImportRequest,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> StatementImportResponse:
    ledger, member = membership
    if not payload.items:
        raise HTTPException(status_code=400, detail="No items to import")

    categories = {
        c.id: c
        for c in (await db.exec(select(Category).where(Category.ledger_id == ledger.id))).all()
    }

    created_txns = []
    total_amount = Decimal(0)

    for it in payload.items:
        if not it.is_selected:
            continue

        cat_id = it.category_id if it.category_id in categories else None

        txn = Transaction(
            ledger_id=ledger.id,
            category_id=cat_id,
            created_by_id=member.user_id,
            type=it.type,
            amount=it.amount,
            currency=it.currency or ledger.currency,
            transaction_date=it.transaction_date,
            payee=it.payee.strip() if it.payee else None,
            memo=it.memo.strip() if it.memo else None,
        )
        db.add(txn)
        created_txns.append(txn)
        total_amount += it.amount

    await db.commit()

    return StatementImportResponse(
        imported_count=len(created_txns),
        total_amount=total_amount,
    )
