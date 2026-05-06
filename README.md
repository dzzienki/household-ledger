# household-ledger

가족과 공유하는 영역과 개인 영역이 분리된 가계부 앱.

## Stack
- **Backend**: FastAPI + SQLModel + Alembic + PostgreSQL ([`backend/`](./backend))
- **Frontend**: Expo (React Native + React Native Web) — *not yet scaffolded*

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
- [ ] Phase 2 — Budgets, charts, search/filter, tags
- [ ] Phase 3 — Recurring transactions, receipt upload, CSV import/export
- [ ] Phase 4 — AI auto-categorization, multi-currency, push notifications
