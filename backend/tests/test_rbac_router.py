"""Role and permission management endpoints."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


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
