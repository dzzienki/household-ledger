from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, categories, health, ledgers, stats, transactions, users
from app.core.config import settings


def create_app() -> FastAPI:
    app = FastAPI(
        title="Household Ledger API",
        version="0.1.0",
        debug=settings.APP_DEBUG,
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
    app.include_router(categories.router, prefix=api_prefix)
    app.include_router(transactions.router, prefix=api_prefix)
    app.include_router(stats.router, prefix=api_prefix)

    return app


app = create_app()
