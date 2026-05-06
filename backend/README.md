# household-ledger backend

FastAPI + SQLModel + Alembic + PostgreSQL.

## Prerequisites
- [`uv`](https://docs.astral.sh/uv/) (`brew install uv`)
- Access to the configured PostgreSQL DB (set in `.env`)

## Setup
```bash
cd backend
cp .env.example .env   # then edit DATABASE_URL / SYNC_DATABASE_URL / JWT_SECRET
uv sync
```

## Database migrations
```bash
# create a new migration after editing models
uv run alembic revision --autogenerate -m "describe change"

# apply pending migrations
uv run alembic upgrade head

# roll back one revision
uv run alembic downgrade -1
```

## Run the server
```bash
uv run uvicorn app.main:app --reload --port 8000
```
- OpenAPI docs: http://127.0.0.1:8000/docs
- Redoc: http://127.0.0.1:8000/redoc
- Health check: http://127.0.0.1:8000/api/health

## API surface (Phase 1)
| Method | Path | Auth |
|---|---|---|
| POST   | /api/auth/signup | public |
| POST   | /api/auth/login | public |
| GET    | /api/users/me | bearer |
| GET    | /api/ledgers | bearer |
| POST   | /api/ledgers | bearer |
| GET / PATCH / DELETE | /api/ledgers/{id} | member / owner |
| GET / POST | /api/ledgers/{id}/members | member / owner |
| DELETE | /api/ledgers/{id}/members/{user_id} | owner |
| GET / POST | /api/ledgers/{id}/categories | member / editor+ |
| PATCH / DELETE | /api/ledgers/{id}/categories/{cat_id} | editor+ |
| GET / POST | /api/ledgers/{id}/transactions | member / editor+ |
| GET / PATCH / DELETE | /api/ledgers/{id}/transactions/{txn_id} | member / editor+ |

Sign-up automatically creates a personal ledger for the new user.

## Tests
```bash
uv run pytest
```
(Test suite not yet scaffolded.)

## Layout
```
backend/
├── app/
│   ├── api/        # FastAPI routers + dependencies
│   ├── core/       # config, db engine, security
│   ├── models/     # SQLModel ORM tables
│   ├── schemas/    # Pydantic request/response models
│   └── main.py
├── alembic/        # migrations
├── alembic.ini
└── pyproject.toml
```
