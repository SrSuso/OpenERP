"""User account endpoints."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.rbac.models import Permission, Role
from app.users.models import User
from tests.conftest import DEFAULT_PASSWORD


async def _cashier_role_id(session: AsyncSession) -> int:
    role = (await session.execute(select(Role).where(Role.name == "CASHIER"))).scalar_one()
    return role.id


async def _role(session: AsyncSession, name: str) -> Role:
    stmt = select(Role).where(Role.name == name).options(selectinload(Role.permissions))
    return (await session.execute(stmt)).scalar_one()


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


async def test_manager_cannot_promote_themselves_to_admin(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    manager = await login(role_name="MANAGER")
    admin_role = await _role(db_session, "ADMIN")

    response = await client.patch(f"/api/v1/users/{manager['id']}", json={"role_id": admin_role.id})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


async def test_manager_cannot_create_an_admin(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="MANAGER")
    admin_role = await _role(db_session, "ADMIN")

    response = await client.post(
        "/api/v1/users",
        json={
            "email": "forbidden-admin@example.com",
            "full_name": "Forbidden Admin",
            "password": "another-secure-pass",
            "role_id": admin_role.id,
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


async def test_manager_cannot_assign_a_custom_role_with_permissions_they_do_not_have(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
    db_session: AsyncSession,
) -> None:
    privileged_permission = (
        await db_session.execute(select(Permission).where(Permission.key == "roles.manage"))
    ).scalar_one()
    custom_role = Role(
        name="CUSTOM-PRIVILEGED",
        description="Contains a permission MANAGER does not have.",
        permissions=[privileged_permission],
    )
    db_session.add(custom_role)
    target = await make_user(email="custom-target@example.com", role_name="CASHIER")
    await db_session.flush()
    await login(role_name="MANAGER")

    response = await client.patch(f"/api/v1/users/{target.id}", json={"role_id": custom_role.id})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


async def test_manager_can_assign_cashier_when_cashier_permissions_are_within_their_own(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
    db_session: AsyncSession,
) -> None:
    manager_role = await _role(db_session, "MANAGER")
    cashier_role = await _role(db_session, "CASHIER")
    manager_keys = {permission.key for permission in manager_role.permissions}
    manager_role.permissions.extend(
        permission for permission in cashier_role.permissions if permission.key not in manager_keys
    )
    target = await make_user(email="assignable-target@example.com", role_name="MANAGER")
    await db_session.flush()
    await login(role_name="MANAGER")

    response = await client.patch(f"/api/v1/users/{target.id}", json={"role_id": cashier_role.id})

    assert response.status_code == 200
    assert response.json()["role_name"] == "CASHIER"
