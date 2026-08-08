"""User account endpoints."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Role
from tests.conftest import DEFAULT_PASSWORD


async def _cashier_role_id(session: AsyncSession) -> int:
    role = (await session.execute(select(Role).where(Role.name == "CASHIER"))).scalar_one()
    return role.id


async def test_admin_can_create_a_user(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    role_id = await _cashier_role_id(db_session)

    response = await client.post(
        "/api/v1/users",
        json={
            "email": "new.cashier@example.com",
            "full_name": "New Cashier",
            "password": "another-secure-pass",
            "role_id": role_id,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "new.cashier@example.com"
    assert body["role_name"] == "CASHIER"
    assert body["is_active"] is True


async def test_duplicate_email_is_a_conflict(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    role_id = await _cashier_role_id(db_session)
    payload = {
        "email": "dup@example.com",
        "full_name": "Dup",
        "password": "another-secure-pass",
        "role_id": role_id,
    }

    first = await client.post("/api/v1/users", json=payload)
    assert first.status_code == 201

    second = await client.post("/api/v1/users", json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "conflict"


async def test_deactivated_user_can_no_longer_log_in(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[Any]],
) -> None:
    await login(role_name="ADMIN")
    target = await make_user(email="soon-gone@example.com", role_name="CASHIER")

    response = await client.post(f"/api/v1/users/{target.id}/deactivate")
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    other_client_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "soon-gone@example.com", "password": DEFAULT_PASSWORD},
    )
    assert other_client_login.status_code == 401


async def test_user_can_change_their_own_password(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    logged_in = await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/users/me/password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "brand-new-password"},
    )
    assert response.status_code == 204

    await client.post("/api/v1/auth/logout")
    relogin = await client.post(
        "/api/v1/auth/login",
        json={"email": logged_in["email"], "password": "brand-new-password"},
    )
    assert relogin.status_code == 200


async def test_change_password_rejects_wrong_current_password(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/users/me/password",
        json={"current_password": "not-the-current-one", "new_password": "brand-new-password"},
    )

    assert response.status_code == 422
