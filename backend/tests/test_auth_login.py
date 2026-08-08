"""POST /auth/login."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from httpx import AsyncClient

from app.users.models import User
from tests.conftest import DEFAULT_PASSWORD


async def test_login_with_correct_credentials_returns_the_user(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    await make_user(email="admin@example.com", role_name="ADMIN")

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": DEFAULT_PASSWORD},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "admin@example.com"
    assert body["role"] == "ADMIN"
    assert "users.manage" in body["permissions"]


async def test_login_sets_an_httponly_cookie(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    await make_user(email="admin@example.com", role_name="ADMIN")

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": DEFAULT_PASSWORD},
    )

    assert "openerp_session" in response.cookies
    set_cookie = response.headers.get("set-cookie", "")
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie


async def test_login_is_case_insensitive_on_email(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    await make_user(email="admin@example.com", role_name="ADMIN")

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "Admin@Example.com", "password": DEFAULT_PASSWORD},
    )

    assert response.status_code == 200


async def test_login_with_wrong_password_is_rejected(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    await make_user(email="admin@example.com", role_name="ADMIN")

    response = await client.post(
        "/api/v1/auth/login", json={"email": "admin@example.com", "password": "wrong"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


async def test_login_with_unknown_email_is_rejected(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": DEFAULT_PASSWORD},
    )

    assert response.status_code == 401


async def test_deactivated_user_cannot_log_in(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    await make_user(email="gone@example.com", role_name="ADMIN", is_active=False)

    response = await client.post(
        "/api/v1/auth/login", json={"email": "gone@example.com", "password": DEFAULT_PASSWORD}
    )

    assert response.status_code == 401
