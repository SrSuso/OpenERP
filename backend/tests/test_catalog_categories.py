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
    assert create_response.json()["is_sold_by_weight"] is False

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
            "is_sold_by_weight": True,
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
    assert category["is_sold_by_weight"] is True
    assert category["margin_rate"] == "25.000000"
    assert category["margin_amount"] == "0.250000"
    assert category["price_formula"] == "cost * 2"
    assert [item["id"] for item in category["taxes"]] == [tax.json()["id"]]

    product = await client.post(
        "/api/v1/products",
        json={
            "name": "Pechuga de pavo",
            "category_id": category["id"],
            "base_unit_name": "KG",
            "cost": "8.00",
            "list_price": "12.50",
        },
    )
    assert product.status_code == 201
    # El POS recibe el comportamiento ya resuelto. No decide por el nombre
    # de la unidad ni acepta una indicación del navegador al vender.
    assert product.json()["is_sold_by_weight"] is True


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
