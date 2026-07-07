import csv
import io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership, require_role
from app.models import Category, Ledger, LedgerMember, LedgerRole, Transaction
from app.models.category import TransactionType
from app.services.statement import parse_statement

router = APIRouter(prefix="/ledgers/{ledger_id}", tags=["csv"])

CanWrite = require_role(LedgerRole.OWNER, LedgerRole.EDITOR)

CSV_HEADER = ["date", "type", "amount", "category", "payee", "memo"]


@router.get("/export.csv")
async def export_csv(
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
):
    ledger, _ = membership

    cat_stmt = select(Category).where(Category.ledger_id == ledger.id)
    categories = {c.id: c for c in (await db.exec(cat_stmt)).all()}

    txn_stmt = (
        select(Transaction)
        .where(Transaction.ledger_id == ledger.id)
        .order_by(Transaction.transaction_date, Transaction.created_at)
    )
    txns = list((await db.exec(txn_stmt)).all())

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_HEADER)
    for t in txns:
        cat = categories.get(t.category_id) if t.category_id else None
        writer.writerow(
            [
                t.transaction_date.isoformat(),
                t.type.value,
                str(t.amount),
                cat.name if cat else "",
                t.payee or "",
                t.memo or "",
            ]
        )
    buf.seek(0)

    filename = f"{ledger.name}-{datetime.now().strftime('%Y%m%d')}.csv"
    encoded = quote(filename, safe="")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename=\"ledger-export.csv\"; filename*=UTF-8''{encoded}",
        },
    )


@router.post("/import.csv")
async def import_csv(
    file: UploadFile,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> dict[str, int | list[str]]:
    ledger, member = membership

    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames or not set(CSV_HEADER).issubset({h.strip().lower() for h in reader.fieldnames}):
        raise HTTPException(
            status_code=400,
            detail=f"CSV must include headers: {', '.join(CSV_HEADER)}",
        )

    cats_by_name: dict[str, Category] = {
        c.name: c for c in (await db.exec(select(Category).where(Category.ledger_id == ledger.id))).all()
    }

    imported = 0
    errors: list[str] = []
    new_categories: dict[tuple[str, TransactionType], Category] = {}

    for line_no, row in enumerate(reader, start=2):
        try:
            row = {k.strip().lower(): (v or "").strip() for k, v in row.items()}
            txn_date = date.fromisoformat(row["date"])
            txn_type = TransactionType(row["type"].lower())
            amount = Decimal(row["amount"].replace(",", ""))
            if amount <= 0:
                raise ValueError("amount must be positive")

            cat_name = row["category"]
            cat: Category | None = None
            if cat_name:
                key = (cat_name, txn_type)
                cat = cats_by_name.get(cat_name)
                if cat is not None and cat.type != txn_type:
                    cat = None  # name collision across types -> create per-type
                if cat is None:
                    cat = new_categories.get(key)
                if cat is None:
                    cat = Category(
                        ledger_id=ledger.id,
                        name=cat_name,
                        type=txn_type,
                        color="#9CA3AF",
                    )
                    db.add(cat)
                    await db.flush()
                    new_categories[key] = cat
                    cats_by_name[cat_name] = cat

            db.add(
                Transaction(
                    ledger_id=ledger.id,
                    category_id=cat.id if cat else None,
                    created_by_id=member.user_id,
                    type=txn_type,
                    amount=amount,
                    currency=ledger.currency,
                    transaction_date=txn_date,
                    payee=row["payee"] or None,
                    memo=row["memo"] or None,
                )
            )
            imported += 1
        except (ValueError, KeyError, InvalidOperation) as exc:
            errors.append(f"line {line_no}: {exc}")

    await db.commit()
    return {
        "imported": imported,
        "categories_created": len(new_categories),
        "errors": errors,
    }


@router.post("/import-statement")
async def import_statement(
    file: UploadFile,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(CanWrite)],
) -> dict[str, int | list[str]]:
    """Import a card/bank statement spreadsheet (.xls/.xlsx) as expense transactions.

    Columns are auto-detected; every valid row becomes an EXPENSE in the ledger's
    base currency, left uncategorized (미분류). Cancelled and non-KRW rows are skipped.
    """
    ledger, member = membership

    name = (file.filename or "").lower()
    if not (name.endswith(".xls") or name.endswith(".xlsx")):
        raise HTTPException(status_code=400, detail="엑셀 파일(.xls 또는 .xlsx)만 가능합니다")

    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="파일이 너무 큽니다 (최대 5MB)")

    try:
        result = parse_statement(file.filename, data)
    except Exception as exc:  # noqa: BLE001 — surface any parse failure as a 400
        raise HTTPException(status_code=400, detail=f"엑셀 분석 실패: {exc}") from exc

    if not result.rows:
        detail = "등록할 거래를 찾지 못했습니다. 카드 이용내역 엑셀 형식인지 확인하세요."
        raise HTTPException(status_code=400, detail=detail)

    for row in result.rows:
        db.add(
            Transaction(
                ledger_id=ledger.id,
                category_id=None,
                created_by_id=member.user_id,
                type=TransactionType(row.txn_type),
                amount=row.amount,
                currency=row.currency,
                transaction_date=row.transaction_date,
                payee=row.payee,
                memo=row.memo,
            )
        )
    await db.commit()

    return {
        "imported": len(result.rows),
        "income_from_cancel": result.income_from_cancel,
        "foreign": result.foreign,
        "skipped": result.skipped,
        "errors": result.errors,
    }
