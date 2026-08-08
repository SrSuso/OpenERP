"""Product categories."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def test_manager_can_create_and_list_categories(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="MANAGER")

    create_response = await client.post("/api/v1/product-categories", json={"name": "Lácteos"})
    assert create_response.status_code == 201
    assert create_response.json()["name"] == "Lácteos"
    assert create_response.json()["is_active"] is True

    list_response = await client.get("/api/v1/product-categories")
    assert list_response.status_code == 200
    assert any(c["name"] == "Lácteos" for c in list_response.json())


async def test_duplicate_category_name_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    payload = {"name": "Bebidas"}
    assert (await client.post("/api/v1/product-categories", json=payload)).status_code == 201

    second = await client.post("/api/v1/product-categories", json=payload)
    assert second.status_code == 409


async def test_cashier_can_read_but_not_manage_categories(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/product-categories")).status_code == 200
    assert (
        await client.post("/api/v1/product-categories", json={"name": "Congelados"})
    ).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/product-categories")

    assert response.status_code == 401
