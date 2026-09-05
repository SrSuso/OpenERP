"""Resumen X vivo y cierre Z final de jornada."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient

_till_counter = 0


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    global _till_counter
    _till_counter += 1
    warehouse = (
        await client.post("/api/v1/warehouses", json={"name": f"Caja Z {_till_counter}"})
    ).json()
    location = (
        await client.post(
            f"/api/v1/warehouses/{warehouse['id']}/locations", json={"name": "Mostrador"}
        )
    ).json()
    return warehouse["id"], location["id"]


async def _sell(
    client: AsyncClient,
    warehouse_id: int,
    location_id: int,
    *,
    sku: str,
    price: str,
    method: str = "CASH",
    tendered: str | None = None,
) -> int:
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": sku,
                "name": f"Producto {sku}",
                "base_unit_name": "UNIDAD",
                "cost": "1.00",
                "list_price": price,
            },
        )
    ).json()
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "1",
        },
    )
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()
    await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": next(p["id"] for p in product["packages"] if p["is_base"]),
            "quantity_packages": "1",
        },
    )
    checkout = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": method, "amount": tendered or price}]},
    )
    assert checkout.status_code == 200, checkout.text
    return int(sale["id"])


async def test_x_is_live_and_never_creates_a_z(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await _sell(client, warehouse_id, location_id, sku="Z-X-1", price="10.00", method="CASH")

    preview = await client.get("/api/v1/x-reports/preview", params={"warehouse_id": warehouse_id})

    assert preview.status_code == 200
    x = preview.json()
    assert x["business_date"]
    assert x["generated_at"]
    assert x["sales_count"] == 1
    assert x["cash_total"] == "10.000000"
    assert x["first_sale_number"] == x["last_sale_number"]
    assert x["final_report"] is None
    assert x["tax_breakdown"] == [
        {
            "rate": "0.000000",
            "taxable_base": "10.000000",
            "tax_amount": "0.000000",
            "total": "10.000000",
        }
    ]
    assert (await client.get("/api/v1/z-reports")).json() == []


async def test_final_z_freezes_identity_and_accounting_breakdowns(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    user = await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await _sell(client, warehouse_id, location_id, sku="Z-FINAL-CASH", price="10.00", method="CASH")
    await _sell(client, warehouse_id, location_id, sku="Z-FINAL-CARD", price="5.00", method="CARD")

    response = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert response.status_code == 201, response.text
    report = response.json()
    assert report["is_final"] is True
    assert report["finalized_at"] == report["closed_at"]
    assert report["business_date"]
    assert report["warehouse_name"] == f"Caja Z {_till_counter}"
    assert report["closed_by_user_id"] == user["id"]
    assert report["closed_by_name"] == user["full_name"]
    assert report["sales_count"] == 2
    assert report["gross_total"] == "15.000000"
    assert report["cash_total"] == "10.000000"
    assert report["card_total"] == "5.000000"
    assert report["first_sale_number"] is not None
    assert report["last_sale_number"] is not None
    assert report["first_sale_number"] < report["last_sale_number"]
    assert report["payment_breakdown"] == [
        {
            "method": "CASH",
            "collected_total": "10.000000",
            "refunded_total": "0.000000",
            "net_total": "10.000000",
        },
        {
            "method": "CARD",
            "collected_total": "5.000000",
            "refunded_total": "0.000000",
            "net_total": "5.000000",
        },
        {
            "method": "OTHER",
            "collected_total": "0.000000",
            "refunded_total": "0.000000",
            "net_total": "0.000000",
        },
    ]
    assert report["terminal_breakdown"] == [
        {
            "terminal_id": None,
            "terminal_name": "Sin terminal",
            "sales_count": 2,
            "gross_total": "15.000000",
        }
    ]
    assert report["cashier_breakdown"] == [
        {
            "cashier_user_id": user["id"],
            "cashier_name": user["full_name"],
            "sales_count": 2,
            "gross_total": "15.000000",
        }
    ]


async def test_final_z_rejects_another_close_and_new_checkout(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await _sell(client, warehouse_id, location_id, sku="Z-LOCK-1", price="10.00")
    first = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})
    assert first.status_code == 201

    repeated = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})
    assert repeated.status_code == 409
    assert "definitiva" in repeated.json()["error"]["message"]

    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "Z-LOCK-2",
                "name": "Producto posterior",
                "base_unit_name": "UNIDAD",
                "cost": "1.00",
                "list_price": "2.00",
            },
        )
    ).json()
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()
    await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": next(p["id"] for p in product["packages"] if p["is_base"]),
            "quantity_packages": "1",
        },
    )
    checkout = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "2.00"}]},
    )
    assert checkout.status_code == 409
    assert "Z definitiva" in checkout.json()["error"]["message"]


async def test_final_z_blocks_economic_return_but_not_physical_return(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    sale_id = await _sell(client, warehouse_id, location_id, sku="Z-RETURN", price="10.00")
    assert (
        await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})
    ).status_code == 201
    sale = (await client.get(f"/api/v1/sales/{sale_id}")).json()
    line_id = sale["lines"][0]["id"]

    economic = await client.post(
        f"/api/v1/sales/{sale_id}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": line_id,
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "0",
                }
            ],
            "refund_method": "CASH",
        },
    )
    assert economic.status_code == 409
    physical = await client.post(
        f"/api/v1/sales/{sale_id}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": line_id,
                    "refund_quantity_packages": "0",
                    "stock_return_quantity_packages": "1",
                }
            ]
        },
    )
    assert physical.status_code == 201
    assert physical.json()["refund"] is None


async def test_z_requires_the_final_close_permission(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, _location_id = await _default_location(client)
    await login(role_name="CASHIER")

    response = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert response.status_code == 403


async def test_empty_cart_does_not_block_the_final_z(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await client.post(
        "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
    )

    response = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert response.status_code == 201
