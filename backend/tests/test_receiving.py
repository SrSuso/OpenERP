"""Goods receipts: a receipt increases inventory, and a purchase order's
status tracks how much of it has arrived.

Covers the phase 9 acceptance cases from the plan:
  9.  Create an order for 100 units.
  10. Receive 60 -> PARTIALLY_RECEIVED, stock +60.
  11. Receive the other 40 -> RECEIVED, stock total +100.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def _create_product(
    client: AsyncClient, sku: str = "RECV-TEST-1", **overrides: Any
) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": "Producto de recepción",
        "base_unit_name": "UNIDAD",
        "cost": "1.00",
        "list_price": "2.00",
    }
    payload.update(overrides)
    response = await client.post("/api/v1/products", json=payload)
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _ordered_order(
    client: AsyncClient, quantity: str = "100"
) -> tuple[int, int, dict[str, Any]]:
    """A supplier + product + placed (ORDERED) purchase order for
    ``quantity`` base units, plus its base-package id."""
    supplier_id = (
        await client.post("/api/v1/suppliers", json={"name": "Proveedor de recepción"})
    ).json()["id"]
    product = await _create_product(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])

    order_id = (
        await client.post("/api/v1/purchase-orders", json={"supplier_id": supplier_id})
    ).json()["id"]
    line_response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": quantity,
            "unit_cost": "0.90",
        },
    )
    line_id = line_response.json()["lines"][0]["id"]
    await client.post(f"/api/v1/purchase-orders/{order_id}/place")

    return order_id, line_id, product


async def test_receiving_60_of_100_leaves_the_order_partially_received(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, line_id, product = await _ordered_order(client)
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [{"purchase_order_line_id": line_id, "quantity_packages": "60"}],
        },
    )

    assert response.status_code == 201

    order = (await client.get(f"/api/v1/purchase-orders/{order_id}")).json()
    assert order["status"] == "PARTIALLY_RECEIVED"
    assert order["lines"][0]["quantity_received"] == "60.000000"

    balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    assert balances[0]["quantity"] == "60.000000"


async def test_receiving_the_remaining_40_completes_the_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, line_id, product = await _ordered_order(client)
    warehouse_id, location_id = await _default_location(client)
    await client.post(
        f"/api/v1/purchase-orders/{order_id}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [{"purchase_order_line_id": line_id, "quantity_packages": "60"}],
        },
    )

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [{"purchase_order_line_id": line_id, "quantity_packages": "40"}],
        },
    )

    assert response.status_code == 201
    order = (await client.get(f"/api/v1/purchase-orders/{order_id}")).json()
    assert order["status"] == "RECEIVED"
    assert order["lines"][0]["quantity_received"] == "100.000000"

    balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    assert balances[0]["quantity"] == "100.000000"


async def test_receiving_uses_a_box_and_lands_in_base_units(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = (
        await client.post("/api/v1/suppliers", json={"name": "Proveedor con cajas"})
    ).json()["id"]
    product = await _create_product(client, sku="RECV-BOX-1")
    box_id = (
        await client.post(
            f"/api/v1/products/{product['id']}/packages",
            json={"name": "CAJA 6", "factor": "6"},
        )
    ).json()["packages"][-1]["id"]
    order_id = (
        await client.post("/api/v1/purchase-orders", json={"supplier_id": supplier_id})
    ).json()["id"]
    line_id = (
        await client.post(
            f"/api/v1/purchase-orders/{order_id}/lines",
            json={
                "product_id": product["id"],
                "package_id": box_id,
                "quantity_packages": "10",
                "unit_cost": "5.40",
            },
        )
    ).json()["lines"][0]["id"]
    await client.post(f"/api/v1/purchase-orders/{order_id}/place")
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [{"purchase_order_line_id": line_id, "quantity_packages": "10"}],
        },
    )

    assert response.status_code == 201
    balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    # 10 boxes * factor 6 = 60 base units.
    assert balances[0]["quantity"] == "60.000000"


async def test_receiving_more_than_ordered_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, line_id, _product = await _ordered_order(client, quantity="10")
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [{"purchase_order_line_id": line_id, "quantity_packages": "11"}],
        },
    )

    assert response.status_code == 422


async def test_cannot_receive_against_a_draft_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = (await client.post("/api/v1/suppliers", json={"name": "Prov X"})).json()["id"]
    order_id = (
        await client.post("/api/v1/purchase-orders", json={"supplier_id": supplier_id})
    ).json()["id"]
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/receipts",
        json={"warehouse_id": warehouse_id, "location_id": location_id, "lines": []},
    )

    assert response.status_code in (409, 422)


async def test_receiving_a_lot_tracked_product_creates_the_lot(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = (
        await client.post("/api/v1/suppliers", json={"name": "Proveedor lácteo"})
    ).json()["id"]
    product = await _create_product(
        client, sku="RECV-LOT-1", track_lots=True, track_expiration=True
    )
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    order_id = (
        await client.post("/api/v1/purchase-orders", json={"supplier_id": supplier_id})
    ).json()["id"]
    line_id = (
        await client.post(
            f"/api/v1/purchase-orders/{order_id}/lines",
            json={
                "product_id": product["id"],
                "package_id": base_id,
                "quantity_packages": "20",
                "unit_cost": "0.50",
            },
        )
    ).json()["lines"][0]["id"]
    await client.post(f"/api/v1/purchase-orders/{order_id}/place")
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [
                {
                    "purchase_order_line_id": line_id,
                    "quantity_packages": "20",
                    "lot_number": "LOTE-RECV-1",
                    "expiration_date": "2026-09-30",
                }
            ],
        },
    )

    assert response.status_code == 201
    receipt_line = response.json()["lines"][0]
    assert receipt_line["lot_number"] == "LOTE-RECV-1"
    assert receipt_line["lot_id"] is not None

    lots = (await client.get("/api/v1/lots", params={"product_id": product["id"]})).json()
    assert len(lots) == 1
    assert lots[0]["lot_number"] == "LOTE-RECV-1"
    assert lots[0]["expiration_date"] == "2026-09-30"
    # And the purchase order is on the lot for traceability.
    assert lots[0]["purchase_order_id"] == order_id

    lot_balances = (
        await client.get(
            f"/api/v1/products/{product['id']}/lot-balances",
            params={"warehouse_id": warehouse_id, "location_id": location_id},
        )
    ).json()
    assert lot_balances[0]["quantity"] == "20.000000"


async def test_receipt_is_traceable_to_its_stock_movements(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, line_id, product = await _ordered_order(client, quantity="15")
    warehouse_id, location_id = await _default_location(client)

    receipt = (
        await client.post(
            f"/api/v1/purchase-orders/{order_id}/receipts",
            json={
                "warehouse_id": warehouse_id,
                "location_id": location_id,
                "lines": [{"purchase_order_line_id": line_id, "quantity_packages": "15"}],
            },
        )
    ).json()
    movement_id = receipt["lines"][0]["stock_movement_id"]
    assert movement_id is not None

    movements = (
        await client.get("/api/v1/stock-movements", params={"product_id": product["id"]})
    ).json()
    assert any(
        m["id"] == movement_id
        and m["movement_type"] == "PURCHASE_RECEIPT"
        and m["reference_type"] == "goods_receipt"
        and m["reference_id"] == receipt["id"]
        for m in movements
    )


async def test_cashier_cannot_read_or_manage_receipts(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/purchase-orders/1/receipts")).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/purchase-orders/1/receipts")

    assert response.status_code == 401


async def test_receiving_a_product_without_stock_control_adds_no_stock(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un producto sin control de existencias no se agota: la venta no le
    descuenta nada. Si recibirlo sumara, el saldo sólo crecería —nada lo
    consume nunca— y en Inventario aparecería un número enorme justo en
    los productos que se marcaron como «no se cuentan». El pedido y la
    recepción quedan registrados igual; lo único que no se apunta es el
    movimiento de almacén."""
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    order_id, line_id, product = await _ordered_order(client, quantity="40")
    updated = await client.patch(f"/api/v1/products/{product['id']}", json={"tracks_stock": False})
    assert updated.json()["effective_tracks_stock"] is False

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [{"purchase_order_line_id": line_id, "quantity_packages": "40"}],
        },
    )

    assert response.status_code == 201
    # La recepción existe y cuenta como recibida para el pedido…
    assert response.json()["lines"][0]["stock_movement_id"] is None
    order = (await client.get(f"/api/v1/purchase-orders/{order_id}")).json()
    assert order["status"] == "RECEIVED"
    # …pero el almacén sigue sin saber nada de este producto.
    balances = (await client.get(f"/api/v1/stock-balance?product_id={product['id']}")).json()
    assert balances == []
