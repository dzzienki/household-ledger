"""Gemini-powered helpers for transaction categorization and receipt OCR.

Uses Google Gemini 2.0 Flash for structured extraction and classification.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from google import genai
from google.genai import types as genai_types

from app.core.config import settings
from app.models import Category

logger = logging.getLogger(__name__)


def is_ai_enabled() -> bool:
    return bool(settings.GEMINI_API_KEY)


def get_ai_status() -> dict[str, Any]:
    return {
        "enabled": is_ai_enabled(),
        "provider": "gemini",
        "model": settings.GEMINI_MODEL,
    }


def _gemini_client() -> genai.Client:
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    return genai.Client(api_key=settings.GEMINI_API_KEY)


def _extract_json(text: str) -> dict[str, Any]:
    """Pull the first JSON object out of an LLM response (tolerates code fences)."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON found in response: {text[:200]}")
    return json.loads(match.group(0))


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@dataclass
class CategorySuggestion:
    category_id: UUID | None
    category_name: str | None
    confidence: float
    reasoning: str


@dataclass
class ReceiptExtraction:
    amount: float | None
    transaction_date: str | None
    payee: str | None
    memo: str | None
    suggested_category_name: str | None
    confidence: float
    reasoning: str


def suggest_category(
    *,
    payee: str | None,
    memo: str | None,
    txn_type: str,
    categories: list[Category],
) -> CategorySuggestion:
    """Pick the best-fit category for the given transaction signals using Gemini."""
    if not is_ai_enabled():
        raise RuntimeError("AI features are disabled (no GEMINI_API_KEY)")

    relevant = [c for c in categories if c.type.value == txn_type]
    if not relevant:
        return CategorySuggestion(None, None, 0.0, "No categories of this type exist")

    catalog_lines = "\n".join(f"- {c.name} (id: {c.id})" for c in relevant)
    system = (
        "You are an assistant that classifies household-ledger transactions into "
        "the user's existing categories. You will be given a list of categories "
        "and a description of a transaction. Reply with JSON only.\n\n"
        f"Categories ({txn_type}):\n{catalog_lines}\n\n"
        "Respond with: "
        '{"category_id": "<uuid or null>", "category_name": "<exact name>", '
        '"confidence": <0.0-1.0>, "reasoning": "<short>"}\n'
        'If nothing fits well (confidence < 0.4), use {"category_id": null, ...}.'
    )
    user_msg = (
        f"Transaction type: {txn_type}\n"
        f"Payee: {payee or '(none)'}\n"
        f"Memo: {memo or '(none)'}\n"
        "Pick the best category."
    )

    try:
        client = _gemini_client()
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=user_msg,
            config=genai_types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        parsed = _extract_json(response.text or "{}")
    except Exception as exc:
        raise RuntimeError(f"Gemini API error: {exc}") from exc

    cat_id_raw = parsed.get("category_id")
    cat_id: UUID | None = None
    if cat_id_raw:
        try:
            cat_id = UUID(str(cat_id_raw))
        except ValueError:
            cat_id = None

    if cat_id is not None and not any(c.id == cat_id for c in relevant):
        cat_id = None

    cat_name = parsed.get("category_name")
    if not cat_id and cat_name:
        for c in relevant:
            if c.name == cat_name:
                cat_id = c.id
                break

    return CategorySuggestion(
        category_id=cat_id,
        category_name=cat_name,
        confidence=float(parsed.get("confidence") or 0),
        reasoning=str(parsed.get("reasoning") or ""),
    )


def extract_receipt(
    *,
    image_bytes: bytes,
    media_type: str,
    categories: list[Category],
) -> ReceiptExtraction:
    """Read a receipt image and pull amount/date/payee plus category using Gemini Vision."""
    if not is_ai_enabled():
        raise RuntimeError("AI features are disabled (no GEMINI_API_KEY)")

    expense_cats = [c.name for c in categories if c.type.value == "expense"]
    catalog = ", ".join(expense_cats) or "(none)"

    system = (
        "You read photos of Korean receipts and extract the structured fields. "
        "Always reply with JSON only — no markdown, no commentary.\n\n"
        f"Available expense categories: {catalog}\n\n"
        "Respond with: "
        '{"amount": <number or null>, "transaction_date": "<YYYY-MM-DD or null>", '
        '"payee": "<merchant or null>", "memo": "<short summary or null>", '
        '"suggested_category_name": "<exact name from list or null>", '
        '"confidence": <0.0-1.0>, "reasoning": "<short>"}\n'
        "Amount must be the total / 결제금액 (not a single line item). "
        "If a value is unclear, set it to null."
    )

    try:
        client = _gemini_client()
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                genai_types.Part.from_bytes(data=image_bytes, mime_type=media_type),
                "Extract the receipt fields.",
            ],
            config=genai_types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        parsed = _extract_json(response.text or "{}")
    except Exception as exc:
        raise RuntimeError(f"Gemini API error: {exc}") from exc

    return ReceiptExtraction(
        amount=_to_float(parsed.get("amount")),
        transaction_date=str(parsed["transaction_date"]) if parsed.get("transaction_date") else None,
        payee=str(parsed["payee"]) if parsed.get("payee") else None,
        memo=str(parsed["memo"]) if parsed.get("memo") else None,
        suggested_category_name=str(parsed["suggested_category_name"])
        if parsed.get("suggested_category_name")
        else None,
        confidence=float(parsed.get("confidence") or 0),
        reasoning=str(parsed.get("reasoning") or ""),
    )
