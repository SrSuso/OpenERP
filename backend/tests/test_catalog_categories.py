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


async def test_admin_can_create_category_with_stock_pricing_and_tax_defaults(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    tax = await client.post("/api/v1/taxes", json={"name": "IVA general", "rate": "21"})
    assert tax.status_code == 201

    response = await client.post(
        "/api/v1/product-categories",
        json={
            "name": "Congelados",
            "tracks_stock": False,
            "margin_rate": "25",
            "margin_amount": "0.25",
            "price_formula": "cost * 2",
            "tax_ids": [tax.json()["id"]],
        },
    )

    assert response.status_code == 201
    category = response.json()
    assert category["name"] == "Congelados"
    assert category["tracks_stock"] is False
    assert category["margin_rate"] == "25.000000"
    assert category["margin_amount"] == "0.250000"
    assert category["price_formula"] == "cost * 2"
    assert [item["id"] for item in category["taxes"]] == [tax.json()["id"]]


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
