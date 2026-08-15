"""Process infrastructure settings.

All runtime infrastructure is interpreted here from ``OPENERP_*`` variables,
mounted ``*_FILE`` values or a development ``.env`` file. Business settings
belong to PostgreSQL's separate ``app.settings`` registry.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic.fields import FieldInfo
from pydantic_settings import (
    BaseSettings,
    NoDecode,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

Environment = Literal["local", "test", "ci", "production"]

_ASYNC_DRIVER = "postgresql+psycopg"
_SYNC_DRIVER = "postgresql+psycopg"
_SCHEME_RE = re.compile(r"^(postgres|postgresql)(\+[a-z0-9_]+)?://")
_DEFAULT_DATABASE_URL = "postgresql://openerp:openerp@127.0.0.1:5432/openerp"


def _with_driver(url: str, driver: str) -> str:
    """Normalise a PostgreSQL URL so it always uses the psycopg (v3) driver."""
    if not _SCHEME_RE.match(url):
        # A URL normally embeds credentials.  Never echo the invalid input in
        # startup errors or logs.
        raise ValueError("Unsupported database URL scheme (expected postgresql://).")
    return _SCHEME_RE.sub(f"{driver}://", url, count=1)


class _EnvironmentFileSource(PydanticBaseSettingsSource):
    """Read ``OPENERP_<FIELD>_FILE`` values before direct environment ones.

    This is intentionally tiny Docker-secret support, not a secret manager:
    the file contains exactly the value the corresponding direct variable
    would contain.  Explicit constructor arguments remain highest priority so
    tests and embedded callers stay deterministic.
    """

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[object | None, str, bool]:
        return None, field_name, False

    def __call__(self) -> dict[str, object]:
        values: dict[str, object] = {}
        for field_name in self.settings_cls.model_fields:
            variable = f"OPENERP_{field_name.upper()}_FILE"
            filename = os.environ.get(variable)
            if not filename:
                continue
            try:
                values[field_name] = Path(filename).read_text(encoding="utf-8").rstrip("\r\n")
            except OSError as exc:
                reason = exc.strerror or "file error"
                raise ValueError(f"Cannot read {variable}: {reason}.") from exc
        return values


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="OPENERP_",
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            _EnvironmentFileSource(settings_cls),
            env_settings,
            dotenv_settings,
            file_secret_settings,
        )

    # --- application -------------------------------------------------------
    app_name: str = "OpenERP"
    environment: Environment = "local"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"

    # --- database ----------------------------------------------------------
    database_url: str = Field(default=_DEFAULT_DATABASE_URL, repr=False)
    db_pool_size: int = Field(default=5, ge=1)
    db_max_overflow: int = Field(default=10, ge=0)
    db_pool_pre_ping: bool = True
    db_echo: bool = False
    # Statement timeout applied to every session (ms). Guards against a runaway
    # query holding row locks taken during checkout.
    db_statement_timeout_ms: int = Field(default=30_000, ge=1_000)

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
    pos_session_cookie_name: str = "openerp_pos_session"
    session_ttl_days: int = Field(default=30, ge=1)
    # Sliding expiry is only written to the database at most once per this
    # interval, so a busy POS terminal doesn't turn every request into a write.
    session_touch_interval_seconds: int = Field(default=60, ge=0)

    # Optional: non-interactive first-admin creation (see app.auth.bootstrap).
    # Never committed anywhere; supplied via environment at deploy time only.
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = Field(default=None, repr=False)

    # --- SMTP / outbox (phase 18) -------------------------------------------
    # Rule 10: SMTP never blocks a sale — nothing in the request path talks to
    # this host directly. Requests only ever write a row to `outbox_messages`
    # (app.jobs); app.jobs.worker, a separate process, is the only thing that
    # opens an SMTP connection. Defaults match the Mailpit dev instance
    # (docker/compose.yml / scripts/dev-mailpit.sh) — a real deployment points
    # these at a real relay.
    smtp_host: str = "127.0.0.1"
    smtp_port: int = Field(default=1025, ge=1, le=65535)
    smtp_use_tls: bool = False
    smtp_username: str | None = None
    smtp_password: str | None = Field(default=None, repr=False)
    smtp_from_email: str = "no-reply@openerp.local"
    # Who gets emailed when a notification rule (phase 17) opens a brand-new
    # incident. Unset means "queue nothing" — notifications still work purely
    # through GET /incidents either way.
    notification_recipient_email: str | None = None

    # --- security (phase 19) ------------------------------------------------
    # POST /auth/login is rate-limited independently by the email being
    # attempted and by client IP, so neither many IPs hammering one account
    # nor one IP hammering many accounts gets unlimited tries. The IP limit
    # is deliberately more generous than the email one: a retail store's
    # till terminals typically share one public IP, so several cashiers
    # mistyping their own passwords must not lock the whole shop out.
    login_rate_limit_max_attempts: int = Field(default=5, ge=1)
    login_rate_limit_window_seconds: float = Field(default=300.0, gt=0)
    login_rate_limit_ip_max_attempts: int = Field(default=20, ge=1)
    login_rate_limit_ip_window_seconds: float = Field(default=300.0, gt=0)

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

    def validate_runtime(self) -> None:
        """Fail before serving traffic when process infrastructure is unsafe.

        Local development retains its documented PostgreSQL default.  A
        production process must name its database explicitly; otherwise a
        forgotten variable could silently point at an unrelated local DB.
        """
        _with_driver(self.database_url, _ASYNC_DRIVER)
        if self.environment == "production" and self.database_url == _DEFAULT_DATABASE_URL:
            raise ValueError("OPENERP_DATABASE_URL must be configured explicitly in production.")
        if self.environment == "production" and self.cors_origins:
            raise ValueError(
                "OPENERP_CORS_ORIGINS must be empty in production; SPA and API are same-origin."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton.  Call ``get_settings.cache_clear()`` in tests
    that need to rebuild settings from a mutated environment."""
    settings = Settings()
    settings.validate_runtime()
    return settings


def get_async_database_url() -> str:
    """The single database URL resolver used by process-level tooling."""
    return get_settings().async_database_url
