import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    ai,
    auth,
    budgets,
    categories,
    checklist,
    csv_io,
    exchange_rates,
    health,
    invitations,
    items,
    ledgers,
    push,
    recurring,
    statements,
    stats,
    tags,
    transactions,
    users,
)
from app.core.config import settings
from app.services.reminders import reminder_loop


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(reminder_loop()) if settings.REMINDERS_ENABLED else None
    yield
    if task:
        task.cancel()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Household Ledger API",
        version="0.1.0",
        debug=settings.APP_DEBUG,
        lifespan=lifespan,
    )

    if settings.cors_origins_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins_list,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    api_prefix = "/api"
    app.include_router(health.router, prefix=api_prefix)
    app.include_router(auth.router, prefix=api_prefix)
    app.include_router(users.router, prefix=api_prefix)
    app.include_router(ledgers.router, prefix=api_prefix)
    app.include_router(invitations.router, prefix=api_prefix)
    app.include_router(categories.router, prefix=api_prefix)
    app.include_router(tags.router, prefix=api_prefix)
    app.include_router(exchange_rates.router, prefix=api_prefix)
    app.include_router(transactions.router, prefix=api_prefix)
    app.include_router(items.router, prefix=api_prefix)
    app.include_router(stats.router, prefix=api_prefix)
    app.include_router(recurring.router, prefix=api_prefix)
    app.include_router(checklist.router, prefix=api_prefix)
    app.include_router(push.router, prefix=api_prefix)
    app.include_router(budgets.router, prefix=api_prefix)
    app.include_router(csv_io.router, prefix=api_prefix)
    app.include_router(statements.router, prefix=api_prefix)
    app.include_router(ai.router, prefix=api_prefix)

    return app


app = create_app()
