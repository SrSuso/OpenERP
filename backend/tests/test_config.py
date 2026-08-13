"""Settings parsing.  No database needed."""

from __future__ import annotations

from typing import Any

import pytest

from app.core.config import Settings
from app.main import create_app


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {"database_url": "postgresql://u:p@localhost:5432/db"}
    return Settings(**(base | overrides))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@localhost:5432/db",
        "postgres://u:p@localhost:5432/db",
        "postgresql+psycopg://u:p@localhost:5432/db",
    ],
)
def test_any_postgres_url_normalises_to_the_psycopg_driver(url: str) -> None:
    settings = _settings(database_url=url)

    assert settings.async_database_url.startswith("postgresql+psycopg://")
    assert settings.async_database_url.endswith("@localhost:5432/db")


def test_non_postgres_url_is_rejected() -> None:
    """Guards against a SQLite fallback sneaking in."""
    settings = _settings(database_url="sqlite:///./openerp.db")

    with pytest.raises(ValueError, match="Unsupported database URL scheme"):
        _ = settings.async_database_url


def test_cors_origins_accept_a_comma_separated_string() -> None:
    settings = _settings(cors_origins="http://a.test, http://b.test")

    assert settings.cors_origins == ["http://a.test", "http://b.test"]


def test_cors_origins_parse_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """The env form is the one deployments use, and it is not JSON."""
    monkeypatch.setenv("OPENERP_DATABASE_URL", "postgresql://u:p@localhost:5432/db")
    monkeypatch.setenv("OPENERP_CORS_ORIGINS", "http://127.0.0.1:5173,https://erp.example")

    settings = Settings()

    assert settings.cors_origins == ["http://127.0.0.1:5173", "https://erp.example"]


def test_a_single_cors_origin_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENERP_DATABASE_URL", "postgresql://u:p@localhost:5432/db")
    monkeypatch.setenv("OPENERP_CORS_ORIGINS", "http://127.0.0.1:5173")

    assert Settings().cors_origins == ["http://127.0.0.1:5173"]


def test_log_level_is_normalised() -> None:
    assert _settings(log_level="debug").log_level == "DEBUG"


def test_environment_drives_is_testing() -> None:
    assert _settings(environment="test").is_testing is True
    assert _settings(environment="production").is_testing is False


def test_settings_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENERP_DATABASE_URL", "postgresql://x:y@db:5432/erp")
    monkeypatch.setenv("OPENERP_LOG_FORMAT", "console")

    settings = Settings()

    assert settings.database_url == "postgresql://x:y@db:5432/erp"
    assert settings.log_format == "console"


def test_file_value_precedes_direct_environment_value(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    secret_file = tmp_path / "database-url"
    secret_file.write_text("postgresql://file:user@db-file:5432/erp\n", encoding="utf-8")
    monkeypatch.setenv("OPENERP_DATABASE_URL", "postgresql://direct:user@db-env:5432/erp")
    monkeypatch.setenv("OPENERP_DATABASE_URL_FILE", str(secret_file))

    settings = Settings()

    assert settings.database_url == "postgresql://file:user@db-file:5432/erp"


def test_valid_production_infrastructure_passes_startup_validation() -> None:
    settings = _settings(environment="production")

    assert create_app(settings).state.settings is settings


def test_production_without_explicit_database_fails_before_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENERP_DATABASE_URL", raising=False)
    settings = Settings(environment="production", _env_file=None)

    with pytest.raises(ValueError, match="OPENERP_DATABASE_URL must be configured"):
        create_app(settings)


def test_malformed_database_url_fails_without_echoing_credentials() -> None:
    invalid = "mysql://sensitive-user:sensitive-password@db/application"
    settings = Settings(database_url=invalid)

    with pytest.raises(ValueError) as caught:
        create_app(settings)

    message = str(caught.value)
    assert "expected postgresql" in message
    assert "sensitive-user" not in message
    assert "sensitive-password" not in message


def test_secret_infrastructure_values_are_excluded_from_repr() -> None:
    secrets = {
        "database_url": "postgresql://fake-db-user:fake-db-password@db/application",
        "bootstrap_admin_password": "fake-bootstrap-password",
        "smtp_password": "fake-smtp-password",
    }

    rendered = repr(Settings(**secrets))  # type: ignore[arg-type]

    assert all(secret not in rendered for secret in secrets.values())
