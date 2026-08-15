"""Dedicated POS username/PIN sessions."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from httpx import AsyncClient

from app.auth.security import hash_password
from app.users.models import User


async def _cashier_with_pin(
    make_user: Callable[..., Awaitable[User]], *, username: str = "cajero"
) -> User:
    user = await make_user(email=f"{username}@example.com", role_name="CASHIER")
    user.pos_username = username
    user.pos_pin_hash = hash_password("1234")
    return user


async def test_pos_login_uses_its_own_cookie_and_can_read_pos_data(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    await _cashier_with_pin(make_user)

    login = await client.post("/api/v1/auth/pos/login", json={"username": "cajero", "pin": "1234"})
    assert login.status_code == 200
    assert "openerp_pos_session" in login.headers["set-cookie"]
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    assert (await client.get("/api/v1/auth/pos/me")).status_code == 200
    assert (
        await client.get("/api/v1/products", headers={"X-OpenERP-Session-Surface": "pos"})
    ).status_code == 200


async def test_pos_logout_does_not_close_administration_session(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    admin = await make_user(email="admin@example.com", role_name="ADMIN")
    admin.pos_username = "admin-pos"
    admin.pos_pin_hash = hash_password("1234")
    admin_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "correct horse battery staple"},
    )
    assert admin_login.status_code == 200
    pos_login = await client.post(
        "/api/v1/auth/pos/login", json={"username": "admin-pos", "pin": "1234"}
    )
    assert pos_login.status_code == 200
    assert (await client.post("/api/v1/auth/pos/logout")).status_code == 204
    assert (await client.get("/api/v1/auth/me")).status_code == 200
    assert (await client.get("/api/v1/auth/pos/me")).status_code == 401


async def test_pos_login_rejects_wrong_pin(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    await _cashier_with_pin(make_user)
    response = await client.post(
        "/api/v1/auth/pos/login", json={"username": "cajero", "pin": "9999"}
    )
    assert response.status_code == 401
