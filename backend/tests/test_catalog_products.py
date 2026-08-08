"""Product catalog: products, packages, barcodes.

Covers the phase 3 acceptance cases from the plan:
  4. Create a product.
  5. Create a "brick" package, factor 1.
  6. Create a "box" package, factor 6.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


def _product_payload(**overrides: Any) -> dict[str, Any]:
    payload = {
        "sku": "MILK-1L",
        "name": "Leche 1L",
        "description": "Leche entera 1 litro",
        "base_unit_name": "BRIK",
        "base_barcode": "111111",
        "cost": "0.60",
        "list_price": "0.95",
        "tax_rate": "4",
        "min_stock": "10",
        "track_lots": True,
        "track_expiration": True,
    }
    payload.update(overrides)
    return payload


async def test_admin_can_create_a_product_with_its_base_package(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post("/api/v1/products", json=_product_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["sku"] == "MILK-1L"
    assert body["is_active"] is True
    assert len(body["packages"]) == 1
    base = body["packages"][0]
    assert base["name"] == "BRIK"
    assert base["factor"] == "1.000000"
    assert base["is_base"] is True
    assert base["barcodes"] == ["111111"]


async def test_adding_a_box_package_with_factor_6(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = (await client.post("/api/v1/products", json=_product_payload())).json()["id"]

    response = await client.post(
        f"/api/v1/products/{product_id}/packages",
        json={"name": "CAJA 6", "factor": "6", "barcode": "666666"},
    )

    assert response.status_code == 200
    body = response.json()
    packages = {p["name"]: p for p in body["packages"]}
    assert set(packages) == {"BRIK", "CAJA 6"}
    assert packages["CAJA 6"]["factor"] == "6.000000"
    assert packages["CAJA 6"]["is_base"] is False
    assert packages["CAJA 6"]["barcodes"] == ["666666"]


async def test_duplicate_sku_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    payload = _product_payload()

    assert (await client.post("/api/v1/products", json=payload)).status_code == 201

    second = await client.post("/api/v1/products", json={**payload, "base_barcode": "222222"})
    assert second.status_code == 409


async def test_duplicate_barcode_across_products_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await client.post("/api/v1/products", json=_product_payload())

    response = await client.post(
        "/api/v1/products",
        json=_product_payload(sku="MILK-2L", name="Leche 2L", base_barcode="111111"),
    )

    assert response.status_code == 409


async def test_duplicate_package_name_on_same_product_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = (await client.post("/api/v1/products", json=_product_payload())).json()["id"]

    response = await client.post(
        f"/api/v1/products/{product_id}/packages", json={"name": "BRIK", "factor": "1"}
    )

    assert response.status_code == 409


async def test_lookup_product_by_barcode(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = (await client.post("/api/v1/products", json=_product_payload())).json()["id"]
    await client.post(
        f"/api/v1/products/{product_id}/packages",
        json={"name": "CAJA 6", "factor": "6", "barcode": "666666"},
    )

    by_brick = await client.get("/api/v1/products/barcode/111111")
    assert by_brick.status_code == 200
    assert by_brick.json()["id"] == product_id

    by_box = await client.get("/api/v1/products/barcode/666666")
    assert by_box.status_code == 200
    assert by_box.json()["id"] == product_id

    missing = await client.get("/api/v1/products/barcode/000000")
    assert missing.status_code == 404


async def test_update_product_and_deactivate(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = (await client.post("/api/v1/products", json=_product_payload())).json()["id"]

    update_response = await client.patch(f"/api/v1/products/{product_id}", json={"min_stock": "25"})
    assert update_response.status_code == 200
    assert update_response.json()["min_stock"] == "25.000000"

    deactivate_response = await client.post(f"/api/v1/products/{product_id}/deactivate")
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["is_active"] is False

    # Deactivated products are hidden from the default (active-only) listing.
    active_list = await client.get("/api/v1/products")
    assert product_id not in {p["id"] for p in active_list.json()}

    full_list = await client.get("/api/v1/products", params={"active_only": False})
    assert product_id in {p["id"] for p in full_list.json()}


async def test_cashier_can_read_but_not_manage_products(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/products")).status_code == 200
    assert (await client.post("/api/v1/products", json=_product_payload())).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/products")

    assert response.status_code == 401
