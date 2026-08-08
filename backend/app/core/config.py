"""Application settings.

All settings are read from environment variables (prefix ``OPENERP_``) or a
``.env`` file.  Nothing in the codebase should read ``os.environ`` directly;
everything goes through :func:`get_settings`.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["local", "test", "ci", "production"]

_ASYNC_DRIVER = "postgresql+psycopg"
_SYNC_DRIVER = "postgresql+psycopg"
_SCHEME_RE = re.compile(r"^(postgres|postgresql)(\+[a-z0-9_]+)?://")


def _with_driver(url: str, driver: str) -> str:
    """Normalise a PostgreSQL URL so it always uses the psycopg (v3) driver."""
    if not _SCHEME_RE.match(url):
        raise ValueError(f"Unsupported database URL scheme: {url!r} (expected postgresql://)")
    return _SCHEME_RE.sub(f"{driver}://", url, count=1)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="OPENERP_",
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- application -------------------------------------------------------
    app_name: str = "OpenERP"
    environment: Environment = "local"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"

    # --- database ----------------------------------------------------------
    database_url: str = "postgresql://openerp:openerp@127.0.0.1:5432/openerp"
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_pre_ping: bool = True
    db_echo: bool = False
    # Statement timeout applied to every session (ms). Guards against a runaway
    # query holding row locks taken during checkout.
    db_statement_timeout_ms: int = 30_000

    # --- logging -----------------------------------------------------------
    log_level: str = "INFO"
    log_format: Literal["json", "console"] = "json"

    # --- http --------------------------------------------------------------
    # NoDecode: without it pydantic-settings tries to JSON-decode the raw
    # environment value before validation, so the comma-separated form that
    # every deployment target uses would raise instead of parsing.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    # --- auth / sessions -----------------------------------------------------
    # Server-side, revocable sessions behind an httpOnly cookie (never a JWT):
    # a compromised or shared-terminal session must be killable instantly, and
    # the frontend already sends `credentials: 'include'` on every request.
    session_cookie_name: str = "openerp_session"
    session_ttl_days: int = 30
    # Sliding expiry is only written to the database at most once per this
    # interval, so a busy POS terminal doesn't turn every request into a write.
    session_touch_interval_seconds: int = 60

    # Optional: non-interactive first-admin creation (see app.auth.bootstrap).
    # Never committed anywhere; supplied via environment at deploy time only.
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None

    @property
    def session_cookie_secure(self) -> bool:
        """``Secure`` requires HTTPS; only enforced outside local dev, where
        the API is plain HTTP."""
        return self.environment == "production"

    @field_validator("log_level")
    @classmethod
    def _upper_log_level(cls, value: str) -> str:
        return value.upper()

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def async_database_url(self) -> str:
        """URL for the asyncio engine used by the API and worker."""
        return _with_driver(self.database_url, _ASYNC_DRIVER)

    @property
    def sync_database_url(self) -> str:
        """URL for synchronous tooling (Alembic runs through the async engine,
        but some scripts want a plain connection)."""
        return _with_driver(self.database_url, _SYNC_DRIVER)

    @property
    def is_testing(self) -> bool:
        return self.environment in ("test", "ci")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton.  Call ``get_settings.cache_clear()`` in tests
    that need to rebuild settings from a mutated environment."""
    return Settings()
