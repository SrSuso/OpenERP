"""Phase 19: login rate limiting behind the trusted production proxy.

The rate limiter (``app.auth.service._login_rate_limiter``) is a genuine
process-level singleton — same as production — so every test here resets it
first via an autouse fixture, rather than relying on execution order to
leave it clean.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, cast

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.audit.models import AuditLog
from app.auth import service as auth_service
from app.auth.models import AuthSession
from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.main import create_app
from app.rbac.models import Role
from app.users.models import User
from tests.conftest import DEFAULT_PASSWORD


@pytest.fixture(autouse=True)
def _reset_login_rate_limiter() -> None:
    auth_service._login_rate_limiter.clear()


async def _fail_login(client: AsyncClient, email: str) -> int:
    response = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "wrong-password"}
    )
    return response.status_code


async def test_repeated_failed_logins_are_rate_limited_by_email(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    email = "ratelimit-email@example.com"
    await make_user(email=email)

    # Default is 5 attempts per window (Settings.login_rate_limit_max_attempts).
    for _ in range(5):
        assert (await _fail_login(client, email)) == 401

    blocked = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "wrong-password"}
    )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"


async def test_rate_limit_is_scoped_per_email(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    """Locking out one account must not lock out a different one."""
    locked_email = "ratelimit-victim@example.com"
    other_email = "ratelimit-bystander@example.com"
    await make_user(email=locked_email)
    await make_user(email=other_email)

    for _ in range(5):
        await _fail_login(client, locked_email)
    assert (await _fail_login(client, locked_email)) == 429

    # A different account, still well under the (more generous) IP limit,
    # must still be able to log in normally.
    response = await client.post(
        "/api/v1/auth/login", json={"email": other_email, "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 200


async def test_a_successful_login_resets_the_counter(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    email = "ratelimit-recovers@example.com"
    await make_user(email=email)

    for _ in range(4):
        assert (await _fail_login(client, email)) == 401

    ok = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": DEFAULT_PASSWORD}
    )
    assert ok.status_code == 200

    # Counter reset by the success above, so another 4 failures (under the
    # limit of 5 again) must not be blocked yet.
    for _ in range(4):
        assert (await _fail_login(client, email)) == 401


async def test_ip_limit_blocks_across_many_different_emails(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    """A single source hammering many different accounts is caught by the
    (more generous) IP-scoped limit even though no single email ever
    crosses its own, tighter limit."""
    for i in range(20):
        email = f"ratelimit-spray-{i}@example.com"
        await make_user(email=email)
        assert (await _fail_login(client, email)) == 401

    # The 21st distinct email trips the shared IP counter even though this
    # specific email has never failed before.
    fresh_email = "ratelimit-spray-final@example.com"
    await make_user(email=fresh_email)
    blocked = await client.post(
        "/api/v1/auth/login", json={"email": fresh_email, "password": "wrong-password"}
    )
    assert blocked.status_code == 429


def _production_app(settings: Settings, db_session: AsyncSession) -> ProxyHeadersMiddleware:
    production = settings.model_copy(
        update={
            "environment": "production",
            "cors_origins": [],
            "login_rate_limit_ip_max_attempts": 3,
        }
    )
    app = create_app(production)
    app.dependency_overrides[get_settings] = lambda: production

    async def _override_session():  # type: ignore[no-untyped-def]
        yield db_session

    app.dependency_overrides[get_session] = _override_session
    return ProxyHeadersMiddleware(cast(Any, app), trusted_hosts=["10.0.0.10"])


async def test_trusted_proxy_ip_flows_to_login_session_and_audit(
    settings: Settings,
    db_session: AsyncSession,
    make_user: Callable[..., Awaitable[User]],
) -> None:
    admin = await make_user(email="proxy-admin@example.com", role_name="ADMIN")
    role_id = (await db_session.execute(select(Role.id).where(Role.name == "CASHIER"))).scalar_one()
    transport = ASGITransport(
        app=cast(Any, _production_app(settings, db_session)), client=("10.0.0.10", 12345)
    )
    headers = {"X-Forwarded-For": "203.0.113.25", "X-Forwarded-Proto": "https"}

    async with AsyncClient(
        transport=transport, base_url="https://erp.test", headers=headers
    ) as proxied:
        login = await proxied.post(
            "/api/v1/auth/login",
            json={"email": admin.email, "password": DEFAULT_PASSWORD},
        )
        assert login.status_code == 200
        cookie = login.headers["set-cookie"]
        assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie

        created = await proxied.post(
            "/api/v1/users",
            json={
                "email": "proxy-created@example.com",
                "full_name": "Proxy Created",
                "password": "secure-proxy-password",
                "role_id": role_id,
            },
        )
        assert created.status_code == 201

    auth_session = (
        (
            await db_session.execute(
                select(AuthSession)
                .where(AuthSession.user_id == admin.id)
                .order_by(AuthSession.id.desc())
            )
        )
        .scalars()
        .first()
    )
    assert auth_session is not None and auth_session.ip == "203.0.113.25"

    # The mutation above uses the same RequestContext source as every audit
    # record. Query the row directly so the assertion is independent of the
    # audit-list endpoint's presentation.
    audit_entry = (
        (
            await db_session.execute(
                select(AuditLog)
                .where(AuditLog.entity_id == created.json()["id"], AuditLog.action == "created")
                .order_by(AuditLog.id.desc())
            )
        )
        .scalars()
        .first()
    )
    assert audit_entry is not None and audit_entry.ip == "203.0.113.25"


async def test_rate_limit_uses_real_proxy_ip_and_keeps_other_ip_independent(
    settings: Settings, db_session: AsyncSession
) -> None:
    transport = ASGITransport(
        app=cast(Any, _production_app(settings, db_session)), client=("10.0.0.10", 12345)
    )
    async with AsyncClient(transport=transport, base_url="https://erp.test") as proxied:
        for index in range(3):
            response = await proxied.post(
                "/api/v1/auth/login",
                headers={"X-Forwarded-For": "203.0.113.25"},
                json={"email": f"spray-a-{index}@example.com", "password": "wrong"},
            )
            assert response.status_code == 401

        blocked = await proxied.post(
            "/api/v1/auth/login",
            headers={"X-Forwarded-For": "203.0.113.25"},
            json={"email": "spray-a-final@example.com", "password": "wrong"},
        )
        independent = await proxied.post(
            "/api/v1/auth/login",
            headers={"X-Forwarded-For": "203.0.113.26"},
            json={"email": "spray-b@example.com", "password": "wrong"},
        )

    assert blocked.status_code == 429
    assert independent.status_code == 401
