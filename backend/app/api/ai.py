from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import select

from app.api.deps import DbDep, get_ledger_membership
from app.models import Category, Ledger, LedgerMember
from app.models.category import TransactionType
from app.services.ai import (
    CategorySuggestion,
    ReceiptExtraction,
    extract_receipt,
    is_ai_enabled,
    suggest_category,
)

router = APIRouter(prefix="/ledgers/{ledger_id}/ai", tags=["ai"])


class CategorizeRequest(BaseModel):
    type: TransactionType
    payee: str | None = None
    memo: str | None = None


@router.get("/status")
async def ai_status() -> dict[str, bool]:
    return {"enabled": is_ai_enabled()}


@router.post("/categorize", response_model=CategorySuggestion)
async def categorize(
    payload: CategorizeRequest,
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> CategorySuggestion:
    if not is_ai_enabled():
        raise HTTPException(status_code=503, detail="AI features are disabled on this server")
    ledger, _ = membership
    cats = list(
        (await db.exec(select(Category).where(Category.ledger_id == ledger.id))).all()
    )
    try:
        return suggest_category(
            payee=payload.payee,
            memo=payload.memo,
            txn_type=payload.type.value,
            categories=cats,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class ReceiptResponse(BaseModel):
    extraction: ReceiptExtraction
    suggested_category_id: str | None


@router.post("/receipt", response_model=ReceiptResponse)
async def receipt_ocr(
    file: Annotated[UploadFile, File()],
    db: DbDep,
    membership: Annotated[tuple[Ledger, LedgerMember], Depends(get_ledger_membership)],
) -> ReceiptResponse:
    if not is_ai_enabled():
        raise HTTPException(status_code=503, detail="AI features are disabled on this server")
    ledger, _ = membership

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    if file.content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise HTTPException(status_code=400, detail="Unsupported image format")

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 10MB)")

    cats = list(
        (await db.exec(select(Category).where(Category.ledger_id == ledger.id))).all()
    )
    try:
        extraction = extract_receipt(
            image_bytes=image_bytes,
            media_type=file.content_type,
            categories=cats,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    suggested_id = None
    if extraction.suggested_category_name:
        for c in cats:
            if c.name == extraction.suggested_category_name and c.type == TransactionType.EXPENSE:
                suggested_id = str(c.id)
                break

    return ReceiptResponse(extraction=extraction, suggested_category_id=suggested_id)
