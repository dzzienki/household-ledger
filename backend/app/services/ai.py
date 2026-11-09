"""Gemini-powered helpers for transaction categorization and receipt OCR.

Uses Google Gemini 2.0 Flash for structured extraction and classification.
"""

from __future__ import annotations

import json
import logging
import random
import re
import time
from dataclasses import dataclass, field
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
        "models_chain": settings.gemini_models_chain,
    }


def _gemini_client() -> genai.Client:
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    return genai.Client(api_key=settings.GEMINI_API_KEY)


def _is_transient_gemini_error(exc: Exception) -> bool:
    """Return True if the error is temporary (e.g. server overload, rate limit, network timeout)."""
    exc_str = str(exc).lower()
    transient_indicators = [
        "503",
        "unavailable",
        "high demand",
        "overloaded",
        "spikes in demand",
        "temporarily unavailable",
        "429",
        "resource_exhausted",
        "quota",
        "rate limit",
        "too many requests",
        "500 internal",
        "502 bad gateway",
        "504 gateway timeout",
        "deadline exceeded",
        "connection reset",
        "connection error",
        "timeout",
    ]
    return any(ind in exc_str for ind in transient_indicators)


def _format_gemini_exception(exc: Exception | None) -> RuntimeError:
    """Transform raw SDK exceptions into polite, user-friendly error messages."""
    if exc is None:
        return RuntimeError("AI 서비스 응답을 받지 못했습니다.")
    exc_str = str(exc)
    exc_str_lower = exc_str.lower()
    if any(k in exc_str_lower for k in ["503", "unavailable", "high demand", "overloaded", "spikes in demand"]):
        return RuntimeError(
            "AI 서비스(Gemini) 사용량이 일시적으로 급증하여 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
        )
    if any(k in exc_str_lower for k in ["429", "resource_exhausted", "quota", "rate limit"]):
        return RuntimeError(
            "AI 서비스(Gemini) 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
        )
    if any(k in exc_str_lower for k in ["api_key_invalid", "unauthenticated", "permission_denied"]):
        return RuntimeError(
            "AI 서비스(Gemini) API 키가 유효하지 않거나 권한이 없습니다. 서버 설정을 확인해 주세요."
        )
    return RuntimeError(f"Gemini API 오류가 발생했습니다: {exc_str}")


def generate_content_with_retry(
    *,
    client: genai.Client,
    contents: Any,
    config: genai_types.GenerateContentConfig,
    models: list[str] | None = None,
    max_retries_per_model: int = 2,
    base_delay: float = 1.0,
) -> Any:
    """Generate content with automatic exponential backoff retry and model fallback.

    If the primary model is experiencing high demand (HTTP 503 / 429), it retries
    with jittered backoff, and if still overloaded, seamlessly falls back to secondary models.
    """
    candidate_models = models or settings.gemini_models_chain
    last_exception: Exception | None = None

    for model_name in candidate_models:
        delay = base_delay
        for attempt in range(max_retries_per_model):
            try:
                logger.info(
                    "Calling Gemini model %s (attempt %d/%d)",
                    model_name,
                    attempt + 1,
                    max_retries_per_model,
                )
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config,
                )
                return response
            except Exception as exc:
                last_exception = exc
                is_transient = _is_transient_gemini_error(exc)
                logger.warning(
                    "Gemini API error on %s (attempt %d/%d, transient=%s): %s",
                    model_name,
                    attempt + 1,
                    max_retries_per_model,
                    is_transient,
                    exc,
                )
                if not is_transient:
                    # Non-transient error (e.g. invalid API key, safety block)
                    raise _format_gemini_exception(exc) from exc

                if attempt < max_retries_per_model - 1:
                    sleep_time = delay + random.uniform(0.1, 0.4)
                    logger.info("Transient error on %s, sleeping %.2fs before retry...", model_name, sleep_time)
                    time.sleep(sleep_time)
                    delay *= 1.8
                else:
                    logger.warning("Retries exhausted for model %s. Checking fallback models...", model_name)

    raise _format_gemini_exception(last_exception)


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
class ReceiptItem:
    name: str
    item_group: str | None
    quantity: float
    unit_price: float | None
    total_price: float


@dataclass
class ReceiptExtraction:
    amount: float | None
    transaction_date: str | None
    payee: str | None
    memo: str | None
    suggested_category_name: str | None
    confidence: float
    reasoning: str
    items: list[ReceiptItem] = field(default_factory=list)


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
        response = generate_content_with_retry(
            client=client,
            contents=user_msg,
            config=genai_types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        parsed = _extract_json(response.text or "{}")
    except RuntimeError:
        raise
    except Exception as exc:
        raise _format_gemini_exception(exc) from exc

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


def suggest_categories_batch(
    items: list[dict[str, Any]],
    categories: list[Category],
) -> dict[str, UUID]:
    """Classify multiple transactions in a single Gemini request to prevent timeouts."""
    if not is_ai_enabled() or not items:
        return {}

    category_map = {str(c.id): c for c in categories}
    cat_by_name = {c.name.strip(): c.id for c in categories}
    catalog_lines = "\n".join(f"- {c.name} (id: {c.id}, type: {c.type.value})" for c in categories)

    system = (
        "You are an assistant that classifies Korean household ledger transactions into "
        "the user's existing categories. You will receive a list of transactions. "
        "For each transaction, pick the best matching category from the available categories list. "
        "Always reply with JSON only.\n\n"
        f"Available categories:\n{catalog_lines}\n\n"
        "Respond with a JSON object containing an 'items' array:\n"
        '{\n'
        '  "items": [\n'
        '    {"id": "<txn_id>", "category_id": "<uuid or null>", "category_name": "<exact name>"}\n'
        '  ]\n'
        '}'
    )

    clean_items = [
        {
            "id": it["id"],
            "type": it.get("type", "expense"),
            "payee": it.get("payee") or "",
            "memo": it.get("memo") or "",
        }
        for it in items
    ]

    user_msg = f"Transactions to classify:\n{json.dumps(clean_items, ensure_ascii=False)}"

    try:
        client = _gemini_client()
        response = generate_content_with_retry(
            client=client,
            contents=user_msg,
            config=genai_types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        parsed = _extract_json(response.text or "{}")
        results: dict[str, UUID] = {}
        for res_item in parsed.get("items", []):
            txn_id = str(res_item.get("id"))
            cat_id_raw = res_item.get("category_id")
            cat_name = res_item.get("category_name")
            matched_id: UUID | None = None
            if cat_id_raw and str(cat_id_raw) in category_map:
                matched_id = UUID(str(cat_id_raw))
            elif cat_name and cat_name.strip() in cat_by_name:
                matched_id = cat_by_name[cat_name.strip()]
            if matched_id:
                results[txn_id] = matched_id
        return results
    except Exception as exc:
        logger.warning("Batch AI categorization error: %s", exc)
        return {}


def extract_receipt(
    *,
    image_bytes: bytes,
    media_type: str,
    categories: list[Category],
) -> ReceiptExtraction:
    """Read a receipt image and pull amount/date/payee plus line items using Gemini Vision."""
    if not is_ai_enabled():
        raise RuntimeError("AI features are disabled (no GEMINI_API_KEY)")

    expense_cats = [c.name for c in categories if c.type.value == "expense"]
    catalog = ", ".join(expense_cats) or "(none)"

    system = (
        "You read photos of Korean receipts and extract structured fields and detailed line items. "
        "Always reply with JSON only — no markdown, no commentary.\n\n"
        f"Available expense categories: {catalog}\n\n"
        "Respond with this exact JSON schema: "
        '{\n'
        '  "amount": <total paid number or null>,\n'
        '  "transaction_date": "<YYYY-MM-DD or null>",\n'
        '  "payee": "<store/merchant name or null>",\n'
        '  "memo": "<brief 1-line summary or null>",\n'
        '  "suggested_category_name": "<exact name from list or null>",\n'
        '  "confidence": <0.0-1.0>,\n'
        '  "reasoning": "<short explanation>",\n'
        '  "items": [\n'
        '    {\n'
        '      "name": "<printed item name on receipt, e.g. 신라면 5입, 햇양파 1.5kg, 서울우유 1L>",\n'
        '      "item_group": "<normalized generic category/group name in Korean, e.g. 라면, 양파, 우유, 계란, 두부, 과자, 커피, 생수, 휴지, 세제, 육류, 채소 or null>",\n'
        '      "quantity": <number, default 1>,\n'
        '      "unit_price": <unit price number or null>,\n'
        '      "total_price": <line total price number>\n'
        '    }\n'
        '  ]\n'
        '}\n'
        "Rules:\n"
        "1. 'amount' must be the final total payment (결제금액 / 합계금액).\n"
        "2. 'items' should contain all purchasable products clearly visible on the receipt. If item prices or quantities are unclear, infer reasonably from line item total.\n"
        "3. 'item_group' must be a concise common noun representing the generic food/product group (e.g. '진라면 매운맛' -> '라면', '대파 한단' -> '대파' or '채소')."
    )

    try:
        client = _gemini_client()
        response = generate_content_with_retry(
            client=client,
            contents=[
                genai_types.Part.from_bytes(data=image_bytes, mime_type=media_type),
                "Extract the receipt fields and line items.",
            ],
            config=genai_types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        parsed = _extract_json(response.text or "{}")
    except RuntimeError:
        raise
    except Exception as exc:
        raise _format_gemini_exception(exc) from exc

    raw_items = parsed.get("items") or []
    items: list[ReceiptItem] = []
    if isinstance(raw_items, list):
        for it in raw_items:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name") or "").strip()
            total_price = _to_float(it.get("total_price"))
            if not name or total_price is None:
                continue
            qty = _to_float(it.get("quantity")) or 1.0
            unit_p = _to_float(it.get("unit_price"))
            group = str(it.get("item_group")).strip() if it.get("item_group") else None
            items.append(
                ReceiptItem(
                    name=name,
                    item_group=group,
                    quantity=qty,
                    unit_price=unit_p,
                    total_price=total_price,
                )
            )

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
        items=items,
    )
