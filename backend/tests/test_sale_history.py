"""Regression tests for immutable completed-sale history."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(item for item in warehouses if item["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(item for item in locations if item["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_completed_tax_included_sale(client: AsyncClient) -> dict[str, Any]:
    settings = (await client.get("/api/v1/pricing/settings")).json()
    changed = await client.put(
        "/api/v1/pricing/settings",
        json={"formula": "cost", "prices_include_tax": True},
    )
    assert changed.status_code == 200

    tax = (await client.post("/api/v1/taxes", json={"name": "IVA histórico", "rate": "21"})).json()
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "HISTORY-TAX-1",
                "name": "Producto histórico",
                "base_unit_name": "UNIDAD",
                "cost": "12.10",
                "list_price": "12.10",
            },
        )
    ).json()
    product = (
        await client.patch(
            f"/api/v1/products/{product['id']}/pricing",
            json={"tax_ids": [tax["id"]]},
        )
    ).json()
    assert product["list_price"] == "12.100000"

    warehouse_id, location_id = await _default_location(client)
    stocked = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "12.10",
        },
    )
    assert stocked.status_code == 201

    sale = (
        await client.post(
            "/api/v1/sales",
            json={"warehouse_id": warehouse_id, "location_id": location_id},
        )
    ).json()
    package_id = next(item["id"] for item in product["packages"] if item["is_base"])
    added = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={
                "product_id": product["id"],
                "package_id": package_id,
                "quantity_packages": "1",
            },
        )
    ).json()
    completed_response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": added["total"]}]},
    )
    assert completed_response.status_code == 200
    completed = completed_response.json()
    assert completed["prices_include_tax"] is True
    return {
        "sale": completed,
        "product": product,
        "tax": tax,
        "warehouse_id": warehouse_id,
        "original_settings": settings,
    }


async def test_completed_sale_keeps_its_fiscal_interpretation_after_settings_change(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    context = await _create_completed_tax_included_sale(client)
    sale = context["sale"]
    before = {
        key: sale["lines"][0][key] for key in ("subtotal", "discount_amount", "tax_amount", "total")
    }
    before["sale_total"] = sale["total"]

    changed = await client.put(
        "/api/v1/pricing/settings",
        json={"formula": "cost * 2", "prices_include_tax": False},
    )
    assert changed.status_code == 200
    changed_tax = await client.patch(f"/api/v1/taxes/{context['tax']['id']}", json={"rate": "4"})
    assert changed_tax.status_code == 200

    reread = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    after = {
        key: reread["lines"][0][key]
        for key in ("subtotal", "discount_amount", "tax_amount", "total")
    }
    after["sale_total"] = reread["total"]
    assert after == before
    assert reread["prices_include_tax"] is True

    template = await client.post(
        "/api/v1/ticket-templates",
        json={"name": "Histórico fiscal", "width_mm": 58, "tax_display": "BREAKDOWN"},
    )
    assert template.status_code == 201
    ticket = (await client.post(f"/api/v1/sales/{sale['id']}/tickets")).json()
    assert "TOTAL" in ticket["rendered_text"]
    assert "12.10" in ticket["rendered_text"]

    report = await client.post(
        "/api/v1/reports/run",
        json={
            "subject": "SALES",
            "dimensions": [],
            "metrics": ["revenue"],
            "filters": {"product_id": context["product"]["id"]},
        },
    )
    assert report.status_code == 200
    assert Decimal(report.json()["rows"][0]["revenue"]) == Decimal(sale["total"])

    closed = await client.post(
        "/api/v1/z-reports", params={"warehouse_id": context["warehouse_id"]}
    )
    assert closed.status_code == 201
    assert Decimal(closed.json()["gross_total"]) == Decimal(sale["total"])

    returned = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale["lines"][0]["id"],
                    "quantity_packages": "1",
                    "economic": True,
                    "physical": False,
                }
            ]
        },
    )
    assert returned.status_code == 201
    assert Decimal(returned.json()["total_refund"]) == Decimal(sale["total"])
