from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_ENV: str = "development"
    APP_DEBUG: bool = True
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000

    DATABASE_URL: str
    SYNC_DATABASE_URL: str

    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    CORS_ORIGINS: str = ""

    GEMINI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-3.8-flash"
    GEMINI_FALLBACK_MODELS: str = "gemini-3.6-flash,gemini-2.5-flash"

    @property
    def gemini_models_chain(self) -> list[str]:
        """Candidate Gemini models to try in order (primary followed by fallbacks, deduplicated)."""
        models = [self.GEMINI_MODEL] if self.GEMINI_MODEL else []
        for m in self.GEMINI_FALLBACK_MODELS.split(","):
            cleaned = m.strip()
            if cleaned and cleaned not in models:
                models.append(cleaned)
        return models or ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"]

    UPLOAD_DIR: str = "uploads"

    # Web Push. VAPID keys are generated on first use and stored in app_settings.
    # Apple's push service rejects bogus subjects, so set a real mailto: in prod.
    VAPID_SUBJECT: str = "mailto:admin@example.com"
    # Where the web app is served; used to build notification click URLs.
    FRONTEND_BASE_PATH: str = "/household-ledger"
    REMINDERS_ENABLED: bool = True
    REMINDER_INTERVAL_SECONDS: int = 300

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
