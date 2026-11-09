"""Parser for Korean SMS & Push notifications (Toss, Toss Bank, Card SMS, Bank alerts).

Extracts payee, amount, transaction date, transaction type, and card/bank details
using rule-based regex parsing with optional AI fallback.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from app.models import Category
from app.models.category import TransactionType
from app.services.ai import _extract_json, _gemini_client, is_ai_enabled
from app.services.statement_parser import _guess_category_by_rules

logger = logging.getLogger(__name__)


@dataclass
class ParsedNotification:
    transaction_date: date
    payee: str
    amount: Decimal
    type: TransactionType
    currency: str = "KRW"
    memo: str | None = None
    card_or_bank: str | None = None
    suggested_category_id: UUID | None = None
    suggested_category_name: str | None = None
    confidence: float = 1.0
    source: str = "regex"


def _clean_amount(text: str) -> Decimal | None:
    cleaned = text.replace(",", "").strip()
    try:
        val = Decimal(cleaned)
        return val if val > 0 else None
    except Exception:
        return None


def _extract_date(text: str) -> date:
    today = date.today()

    # Match YYYY[-/.]MM[-/.]DD
    m_full = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", text)
    if m_full:
        y, m, d = m_full.groups()
        try:
            return date(int(y), int(m), int(d))
        except ValueError:
            pass

    # Match MM/DD or MM.DD or MM-DD or MM월 DD일
    m_short = re.search(r"(\d{1,2})[/.-](\d{1,2})", text)
    if not m_short:
        m_short = re.search(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일", text)

    if m_short:
        m, d = m_short.groups()
        try:
            mo = int(m)
            day = int(d)
            if 1 <= mo <= 12 and 1 <= day <= 31:
                return date(today.year, mo, day)
        except ValueError:
            pass

    return today


def _detect_bank_or_card(text: str, sender: str | None) -> str | None:
    combined = f"{sender or ''} {text}".upper()
    if "토스뱅크" in combined or "TOSSBANK" in combined:
        return "토스뱅크"
    if "토스" in combined or "TOSS" in combined:
        return "토스"
    if "카카오뱅크" in combined or "KAKAOBANK" in combined:
        return "카카오뱅크"
    if "케이뱅크" in combined or "KBANK" in combined:
        return "케이뱅크"
    if "KB" in combined or "국민" in combined:
        return "KB국민카드"
    if "신한" in combined:
        return "신한카드"
    if "현대" in combined:
        return "현대카드"
    if "삼성" in combined:
        return "삼성카드"
    if "우리" in combined:
        return "우리카드"
    if "하나" in combined:
        return "하나카드"
    if "농협" in combined or "NH" in combined:
        return "NH농협"
    if "롯데" in combined:
        return "롯데카드"
    if "비씨" in combined or "BC" in combined:
        return "BC카드"
    return sender.strip() if sender and sender.strip() else None


def _parse_notification_regex(text: str, sender: str | None) -> ParsedNotification | None:
    raw = text.strip()
    bank_card = _detect_bank_or_card(raw, sender)

    # 1. Detect transaction type
    txn_type = TransactionType.EXPENSE
    if any(k in raw for k in ["입금", "보냈어요", "받았어요", "캐시백", "환급", "적립", "이자", "취소"]):
        if "에게 보냈어요" in raw or "님에게" in raw or "에게 송금" in raw:
            txn_type = TransactionType.EXPENSE
        elif "님이 보냈어요" in raw or "입금" in raw or "캐시백" in raw or "취소" in raw or "받았어요" in raw:
            txn_type = TransactionType.INCOME

    # 2. Extract date
    txn_date = _extract_date(raw)

    # 3. Extract amount
    amount: Decimal | None = None
    m_amt = re.search(r"([\d,]+)\s*원", raw)
    if m_amt:
        amount = _clean_amount(m_amt.group(1))
    if not amount:
        m_krw = re.search(r"(?:KRW|₩)\s*([\d,]+)", raw, re.IGNORECASE)
        if m_krw:
            amount = _clean_amount(m_krw.group(1))

    if not amount or amount <= 0:
        return None

    # 4. Extract payee
    payee: str | None = None
    memo: str | None = None

    # Pattern A: Toss "스타벅스에서 5,500원 결제했어요"
    m_toss1 = re.search(r"(.+?)(?:에서|으로)\s*[\d,]+\s*원\s*(?:결제|송금)", raw)
    if m_toss1:
        p = m_toss1.group(1).replace("[토스]", "").replace("[토스뱅크]", "").strip()
        if p and len(p) < 40:
            payee = p

    # Pattern B: Toss "5,500원 결제 | 스타벅스" or "결제 - 스타벅스"
    if not payee:
        m_toss2 = re.search(r"[\d,]+\s*원\s*(?:결제|승인|출금)\s*(?:\||-)\s*([^\n\r]+)", raw)
        if m_toss2:
            payee = m_toss2.group(1).strip()

    # Pattern C: Toss "홍길동님에게 20,000원을 보냈어요" / "홍길동님이 30,000원을 보냈어요"
    if not payee:
        m_send = re.search(r"([^\s\n]+)님(?:에게|이)\s*[\d,]+\s*원", raw)
        if m_send:
            name = m_send.group(1).strip()
            payee = f"{name}(송금)" if txn_type == TransactionType.EXPENSE else f"{name}(입금)"

    # Pattern D: Toss Bank "[토스뱅크] 출금 15,000원 스타벅스 잔액 230,000원"
    if not payee:
        m_tb = re.search(r"(?:출금|입금|체크카드\s*승인)\s*[\d,]+\s*원\s+([^\s\n]+)", raw)
        if m_tb:
            p = m_tb.group(1).strip()
            if p not in ["잔액", "누적", "일시불"]:
                payee = p

    # Pattern E: Standard Card SMS: e.g. "[Web발신] KB국민카드 1*2* 승인 홍*동 12,000원 일시불 11/09 13:20 메가MGC커피"
    if not payee:
        lines = [line.strip() for line in raw.split("\n") if line.strip()]
        for line in lines:
            line_cleaned = re.sub(r"\[.*?\]", " ", line)
            line_cleaned = re.sub(r"(?:Web발신|체크승인|승인|출금|입금|일시불|\d+개월|잔여누적.*?|누적.*?|잔액.*?)", " ", line_cleaned)
            line_cleaned = re.sub(r"[\d,]+\s*원", " ", line_cleaned)
            line_cleaned = re.sub(r"\d{1,2}[/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?", " ", line_cleaned)
            line_cleaned = re.sub(r"\d{1,2}:\d{2}", " ", line_cleaned)
            line_cleaned = re.sub(r"\b\d+\*+\d*\b", " ", line_cleaned)  # masked card no
            tokens = [t.strip() for t in line_cleaned.split() if len(t.strip()) > 1]
            if tokens:
                filtered_tokens = [t for t in tokens if not re.match(r"^[0-9\W]+$", t)]
                if filtered_tokens:
                    payee = filtered_tokens[-1]
                    break

    if not payee:
        payee = bank_card or "거래내역"

    # Clean up payee artifacts
    payee = re.sub(r"^(?:\[.*?\]|\(주\)|\(유\)|\(사\))\s*", "", payee).strip()
    payee = re.sub(r"\s*(?:결제했어요|보냈어요|출금|입금)$", "", payee).strip()

    # Extract balance into memo if present
    m_bal = re.search(r"잔액\s*([\d,]+)\s*원", raw)
    if m_bal:
        memo = f"잔액 {m_bal.group(1)}원"

    if bank_card:
        memo = f"{bank_card} | {memo}" if memo else bank_card

    return ParsedNotification(
        transaction_date=txn_date,
        payee=payee[:100],
        amount=amount,
        type=txn_type,
        currency="KRW",
        memo=memo[:500] if memo else None,
        card_or_bank=bank_card,
        confidence=1.0,
        source="regex",
    )


def _parse_notification_ai(text: str, sender: str | None) -> ParsedNotification | None:
    if not is_ai_enabled():
        return None

    client = _gemini_client()
    from google.genai import types as genai_types
    from app.services.ai import generate_content_with_retry

    prompt = (
        "Extract the transaction details from this Korean SMS / Toss notification message.\n"
        f"Sender: {sender or 'None'}\n"
        f"Message: {text}\n"
        f"Today's date: {date.today().strftime('%Y-%m-%d')}\n\n"
        "Return JSON only with this schema:\n"
        "{\n"
        '  "transaction_date": "YYYY-MM-DD",\n'
        '  "payee": "merchant or person name",\n'
        '  "amount": 10000,\n'
        '  "type": "expense or income",\n'
        '  "memo": "card name or note or null"\n'
        "}"
    )

    try:
        res = generate_content_with_retry(
            client=client,
            contents=[prompt],
            config=genai_types.GenerateContentConfig(
                system_instruction="Extract transaction from Korean banking notification into JSON.",
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        data = _extract_json(res.text or "{}")
        amt = Decimal(str(data.get("amount", 0)))
        if amt <= 0:
            return None

        p_date = _extract_date(str(data.get("transaction_date", "")))
        p_type = TransactionType.INCOME if str(data.get("type")).lower() == "income" else TransactionType.EXPENSE
        p_payee = str(data.get("payee") or "미분류").strip()

        return ParsedNotification(
            transaction_date=p_date,
            payee=p_payee[:100],
            amount=amt,
            type=p_type,
            currency="KRW",
            memo=data.get("memo"),
            confidence=0.85,
            source="ai",
        )
    except Exception as exc:
        logger.warning(f"AI notification parse failed: {exc}")
        return None


def parse_notification(
    text: str,
    sender: str | None = None,
    categories: list[Category] | None = None,
) -> ParsedNotification | None:
    """Parse SMS or push notification, trying regex first and AI fallback."""
    result = _parse_notification_regex(text, sender)
    if not result:
        result = _parse_notification_ai(text, sender)

    if result and categories:
        cat_id, cat_name = _guess_category_by_rules(
            result.payee, categories, txn_type=result.type.value
        )
        result.suggested_category_id = cat_id
        result.suggested_category_name = cat_name

    return result
