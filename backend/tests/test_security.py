"""Phase 19: the login rate limiter and the security headers middleware.

The rate limiter (``app.auth.service._login_rate_limiter``) is a genuine
process-level singleton — same as production — so every test here resets it
first via an autouse fixture, rather than relying on execution order to
leave it clean.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

from app.auth import service as auth_service
from app.users.models import User
from tests.conftest import DEFAULT_PASSWORD


@pytest.fixture(autouse=True)
def _reset_login_rate_limiter() -> None:
    auth_service._login_rate_limiter._hits.clear()


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


async def test_security_headers_present_on_a_normal_response(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/live")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "same-origin"
    assert "geolocation=()" in response.headers["permissions-policy"]


async def test_hsts_is_absent_outside_production(client: AsyncClient) -> None:
    # The `settings` fixture uses environment="test".
    response = await client.get("/api/v1/health/live")
    assert "strict-transport-security" not in response.headers
