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
    user.pos_access_enabled = True
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
    admin.pos_access_enabled = True
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


async def test_pos_login_rejects_a_user_disabled_by_administration(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    user = await _cashier_with_pin(make_user)
    user.pos_access_enabled = False

    response = await client.post(
        "/api/v1/auth/pos/login", json={"username": user.pos_username, "pin": "1234"}
    )

    assert response.status_code == 401


async def test_pos_login_picker_lists_only_enabled_eligible_users(
    client: AsyncClient, make_user: Callable[..., Awaitable[User]]
) -> None:
    listed = await _cashier_with_pin(make_user, username="maria")
    listed.full_name = "María Caja"
    disabled = await _cashier_with_pin(make_user, username="ana")
    disabled.pos_access_enabled = False
    manager = await make_user(email="manager@example.com", role_name="MANAGER")
    manager.pos_username = "manager"
    manager.pos_pin_hash = hash_password("1234")
    manager.pos_access_enabled = True

    response = await client.get("/api/v1/auth/pos/users")

    assert response.status_code == 200
    assert response.json() == [{"id": listed.id, "full_name": "María Caja", "username": "maria"}]
