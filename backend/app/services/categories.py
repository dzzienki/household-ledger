from uuid import UUID

from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import Category, TransactionType

DEFAULT_EXPENSE_CATEGORIES: list[tuple[str, str, str | None]] = [
    ("식비", "#EF4444", "utensils"),
    ("교통", "#F59E0B", "car"),
    ("주거", "#8B5CF6", "home"),
    ("통신", "#3B82F6", "phone"),
    ("의료", "#EC4899", "heart-pulse"),
    ("쇼핑", "#10B981", "bag"),
    ("문화/여가", "#F97316", "ticket"),
    ("교육", "#06B6D4", "book"),
    ("기타 지출", "#6B7280", "ellipsis"),
]

DEFAULT_INCOME_CATEGORIES: list[tuple[str, str, str | None]] = [
    ("급여", "#22C55E", "cash"),
    ("부수입", "#84CC16", "briefcase"),
    ("이자/배당", "#A855F7", "bank"),
    ("기타 수입", "#6B7280", "ellipsis"),
]


async def seed_default_categories(db: AsyncSession, ledger_id: UUID) -> None:
    rows: list[Category] = []
    for sort_order, (name, color, icon) in enumerate(DEFAULT_EXPENSE_CATEGORIES):
        rows.append(
            Category(
                ledger_id=ledger_id,
                name=name,
                type=TransactionType.EXPENSE,
                color=color,
                icon=icon,
                sort_order=sort_order,
            )
        )
    for sort_order, (name, color, icon) in enumerate(DEFAULT_INCOME_CATEGORIES):
        rows.append(
            Category(
                ledger_id=ledger_id,
                name=name,
                type=TransactionType.INCOME,
                color=color,
                icon=icon,
                sort_order=sort_order,
            )
        )
    db.add_all(rows)
    await db.flush()
