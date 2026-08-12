"""Role and permission management endpoints."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Permission, Role


async def test_admin_can_list_the_seeded_roles(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get("/api/v1/roles")

    assert response.status_code == 200
    names = {role["name"] for role in response.json()}
    assert {"ADMIN", "MANAGER", "CASHIER"} <= names


async def test_admin_can_list_the_permission_catalogue(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get("/api/v1/permissions")

    assert response.status_code == 200
    keys = {p["key"] for p in response.json()}
    assert {"admin.access", "pos.access", "users.manage", "roles.manage"} <= keys


async def test_admin_can_create_a_role_and_grant_permissions(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    create_response = await client.post(
        "/api/v1/roles", json={"name": "AUDITOR", "description": "Read-only oversight."}
    )
    assert create_response.status_code == 201
    role_id = create_response.json()["id"]
    assert create_response.json()["permissions"] == []

    grant_response = await client.patch(
        f"/api/v1/roles/{role_id}/permissions", json={"permission_keys": ["admin.access"]}
    )
    assert grant_response.status_code == 200
    assert grant_response.json()["permissions"] == ["admin.access"]


async def test_granting_an_unknown_permission_key_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    role_id = (await client.post("/api/v1/roles", json={"name": "TEMP", "description": ""})).json()[
        "id"
    ]

    response = await client.patch(
        f"/api/v1/roles/{role_id}/permissions", json={"permission_keys": ["not.a.real.permission"]}
    )

    assert response.status_code == 422


async def test_duplicate_role_name_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post("/api/v1/roles", json={"name": "ADMIN", "description": ""})

    assert response.status_code == 409


async def test_role_manager_cannot_grant_a_permission_they_do_not_have(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    roles_manage = (
        await db_session.execute(select(Permission).where(Permission.key == "roles.manage"))
    ).scalar_one()
    restricted_role = Role(
        name="RESTRICTED-ROLE-MANAGER",
        description="Can manage role definitions, but not grant arbitrary permissions.",
        permissions=[roles_manage],
    )
    db_session.add(restricted_role)
    await db_session.flush()
    await login(role_name=restricted_role.name)
    target_id = (
        await client.post("/api/v1/roles", json={"name": "TARGET-ROLE", "description": ""})
    ).json()["id"]

    response = await client.patch(
        f"/api/v1/roles/{target_id}/permissions",
        json={"permission_keys": ["settings.manage"]},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


async def test_cannot_remove_a_critical_permission_from_the_last_recoverable_role(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    admin_role = (await db_session.execute(select(Role).where(Role.name == "ADMIN"))).scalar_one()
    current = (await client.get("/api/v1/roles")).json()
    admin_permissions = next(role["permissions"] for role in current if role["name"] == "ADMIN")

    response = await client.patch(
        f"/api/v1/roles/{admin_role.id}/permissions",
        json={"permission_keys": [key for key in admin_permissions if key != "roles.manage"]},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"
