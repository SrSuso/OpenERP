"""Sales (phase 11): building a cart (open a sale, add/remove lines, cancel
it). No stock is ever touched here — that, and reaching ``COMPLETED``, is
exclusively phase 13's job once payments exist."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_product(
    client: AsyncClient, sku: str = "SALE-TEST-1", **overrides: Any
) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": "Producto de venta",
        "base_unit_name": "UNIDAD",
        "cost": "1.00",
        "list_price": "10.00",
        "tax_rate": "21",
    }
    payload.update(overrides)
    response = await client.post("/api/v1/products", json=payload)
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def _open_sale(client: AsyncClient) -> dict[str, Any]:
    warehouse_id, location_id = await _default_location(client)
    response = await client.post(
        "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
    )
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def test_cashier_can_open_a_sale_and_add_a_line(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)
    assert sale["status"] == "DRAFT"
    assert sale["lines"] == []

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "3"},
    )

    assert response.status_code == 201
    body = response.json()
    line = body["lines"][0]
    assert line["quantity_packages"] == "3.000000"
    assert line["quantity_base"] == "3.000000"
    assert line["unit_price"] == "10.000000"
    # El PVP ya lleva el IVA (fórmula de fábrica), así que se cobra la
    # etiqueta y el impuesto se extrae de dentro: 3 * 10 = 30 cobrados, de
    # los cuales 30 - 30/1,21 = 5,21 son IVA.
    assert line["subtotal"] == "30.000000"
    assert line["tax_amount"] == "5.206612"
    assert line["total"] == "30.000000"
    assert body["total"] == "30.000000"


async def test_line_price_is_a_snapshot_and_ignores_later_price_changes(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-SNAP", list_price="10.00")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    sale = await _open_sale(client)
    await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )

    # Change the price after the line was rung up (rule 7).
    await client.put(
        f"/api/v1/products/{product['id']}/pricing/manual-price", json={"list_price": "999.00"}
    )

    refreshed = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert refreshed["lines"][0]["unit_price"] == "10.000000"


async def test_selling_a_box_converts_to_base_units(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-BOX", list_price="1.00")
    box_id = (
        await client.post(
            f"/api/v1/products/{product['id']}/packages", json={"name": "CAJA 6", "factor": "6"}
        )
    ).json()["packages"][-1]["id"]
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": box_id, "quantity_packages": "2"},
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["quantity_packages"] == "2.000000"
    assert line["quantity_base"] == "12.000000"


async def test_discount_rate_is_applied_before_tax(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(
        client, sku="SALE-TEST-DISC", list_price="100.00", tax_rate="10"
    )
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "1",
            "discount_rate": "10",
        },
    )

    line = response.json()["lines"][0]
    # El descuento se aplica antes que nada: subtotal 100, descuento 10% ->
    # 10, quedan 90 a cobrar. Como el PVP ya lleva el IVA dentro, esos 90
    # son el total, y el 10% de impuesto se extrae: 90 - 90/1,10 = 8,18.
    assert line["discount_amount"] == "10.000000"
    assert line["tax_amount"] == "8.181818"
    assert line["total"] == "90.000000"


async def test_add_line_by_barcode(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-BARCODE", base_barcode="8412345000019")
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines/by-barcode",
        json={"barcode": "8412345000019", "quantity_packages": "2"},
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["product_id"] == product["id"]
    assert line["quantity_packages"] == "2.000000"


async def test_removing_a_line_recomputes_the_total(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-REMOVE")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)
    added = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
        )
    ).json()
    line_id = added["lines"][0]["id"]

    response = await client.delete(f"/api/v1/sales/{sale['id']}/lines/{line_id}")

    assert response.status_code == 200
    assert response.json()["lines"] == []
    assert Decimal(response.json()["total"]) == Decimal(0)


async def test_cannot_sell_a_deactivated_product(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-INACTIVE")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await client.post(f"/api/v1/products/{product['id']}/deactivate")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )

    assert response.status_code == 422


async def test_cancel_sale_and_then_reject_further_mutation(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-CANCEL")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    cancel_response = await client.post(f"/api/v1/sales/{sale['id']}/cancel")
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "CANCELLED"

    add_after_cancel = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )
    assert add_after_cancel.status_code == 409

    second_cancel = await client.post(f"/api/v1/sales/{sale['id']}/cancel")
    assert second_cancel.status_code == 409


async def test_sale_location_must_belong_to_its_warehouse(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, _location_id = await _default_location(client)
    other_warehouse_id = (
        await client.post("/api/v1/warehouses", json={"name": "Otro almacén"})
    ).json()["id"]
    other_location_id = (
        await client.post(
            f"/api/v1/warehouses/{other_warehouse_id}/locations", json={"name": "Otra ubicación"}
        )
    ).json()["id"]

    response = await client.post(
        "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": other_location_id}
    )

    assert response.status_code == 422


async def test_cashier_can_list_and_read_sales(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    listed = (await client.get("/api/v1/sales")).json()
    assert any(s["id"] == sale["id"] for s in listed)

    fetched = await client.get(f"/api/v1/sales/{sale['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == sale["id"]


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/sales")

    assert response.status_code == 401
