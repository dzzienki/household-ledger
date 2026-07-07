# household-ledger

가족과 공유하는 영역과 개인 영역이 분리된 가계부 앱.

## Stack
- **Backend**: FastAPI + SQLModel + Alembic + PostgreSQL ([`backend/`](./backend))
- **Frontend**: Expo (React Native + React Native Web) + Expo Router + React Query ([`frontend/`](./frontend))

## Quick start (backend)
See [backend/README.md](./backend/README.md).

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

## Roadmap
- [x] Phase 1 — Auth, Ledgers (personal + shared), Members, Categories, Transactions
- [x] Phase 2 — Budgets, charts, search/filter, tags (per-ledger, many-to-many, filterable)
- [x] Phase 3 — Recurring transactions, receipt upload (AI OCR), CSV import/export
- [~] Phase 4 — In progress
  - [x] AI auto-categorization + receipt OCR (Claude, prompt-cached)
  - [x] Multi-currency — per-transaction currency + per-ledger exchange rates; stats convert to the ledger base currency
  - [ ] Push notifications — not started
