"""A12: infrastructure settings come only from the process environment."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import bootstrap
from app.core import config
from app.jobs import worker
from app.main import create_app
from app.settings.models import Setting


async def test_legacy_database_setting_cannot_change_any_component(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    """Environment A wins even while PostgreSQL still contains legacy B."""
    database_a = "postgresql://environment:password@db-a:5432/application"
    database_b = "postgresql://legacy:password@db-b:5432/legacy"
    db_session.add(Setting(key="server.database_url", value=database_b))
    await db_session.flush()
    monkeypatch.setenv("OPENERP_DATABASE_URL", database_a)
    config.get_settings.cache_clear()
    try:
        environment = config.get_settings()

        assert create_app().state.settings.database_url == database_a  # API
        # Both components import the same central resolver; calling their
        # bound symbol proves neither has a separate parser/DB fallback.
        assert worker.get_settings().database_url == database_a  # type: ignore[attr-defined]
        assert bootstrap.get_settings().database_url == database_a  # type: ignore[attr-defined]
        assert config.get_async_database_url() == environment.async_database_url  # Alembic
    finally:
        config.get_settings.cache_clear()


async def test_server_keys_are_unknown_and_never_exposed(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    """Legacy secrets in the table are neither readable nor writable by API."""
    db_session.add_all(
        [
            Setting(key="server.database_url", value="postgresql://fake:secret@legacy/db"),
            Setting(key="server.bootstrap_admin_password", value="obviously-fake-password"),
        ]
    )
    await db_session.flush()
    await login(role_name="ADMIN")

    options = await client.get("/api/v1/settings/options")
    values = await client.get("/api/v1/settings/values")
    rejected = await client.put(
        "/api/v1/settings/options",
        json={"values": {"server.database_url": "postgresql://another/db"}},
    )

    assert options.status_code == 200
    assert all(not item["key"].startswith("server.") for item in options.json()["settings"])
    assert all(not key.startswith("server.") for key in values.json())
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "validation_error"


async def test_smtp_runtime_endpoints_no_longer_exist(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    assert (await client.get("/api/v1/settings/smtp")).status_code == 404
    assert (
        await client.put("/api/v1/settings/smtp", json={"smtp_password": "fake-password"})
    ).status_code == 404
    assert (
        await client.post(
            "/api/v1/settings/smtp/test", json={"to_email": "operator@example.invalid"}
        )
    ).status_code == 404


async def test_business_timezone_remains_persisted_and_editable(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    saved = await client.put(
        "/api/v1/settings/options",
        json={"values": {"business.timezone": "Europe/Lisbon"}},
    )

    assert saved.status_code == 200
    timezone = next(item for item in saved.json()["settings"] if item["key"] == "business.timezone")
    assert timezone["value"] == "Europe/Lisbon"
