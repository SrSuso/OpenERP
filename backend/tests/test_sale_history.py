"""Regression tests for immutable completed-sale history."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product, ProductPackage
from app.users.models import User


async def _new_location(client: AsyncClient, warehouse_name: str) -> tuple[int, int]:
    warehouse = (await client.post("/api/v1/warehouses", json={"name": warehouse_name})).json()
    location = (
        await client.post(
            f"/api/v1/warehouses/{warehouse['id']}/locations",
            json={"name": "Mostrador"},
        )
    ).json()
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

    warehouse_id, location_id = await _new_location(client, "Histórico fiscal")
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
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "0",
                }
            ],
            "refund_method": "CASH",
        },
    )
    assert returned.status_code == 201
    assert Decimal(returned.json()["total_refund"]) == Decimal(sale["total"])


async def test_completed_sale_keeps_product_category_cost_and_cashier_snapshots(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    original_category = (
        await client.post("/api/v1/product-categories", json={"name": "Categoría original"})
    ).json()
    replacement_category = (
        await client.post("/api/v1/product-categories", json={"name": "Categoría nueva"})
    ).json()
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "HISTORY-IDENTITY-1",
                "name": "Nombre original",
                "category_id": original_category["id"],
                "base_unit_name": "UNIDAD",
                "cost": "2.50",
                "list_price": "10.00",
            },
        )
    ).json()
    template = await client.post(
        "/api/v1/ticket-templates",
        json={"name": "Histórico identidad", "width_mm": 58, "show_cashier": True},
    )
    assert template.status_code == 201
    warehouse_id, location_id = await _new_location(client, "Histórico identidad")
    stocked = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "2.50",
        },
    )
    assert stocked.status_code == 201

    cashier = await login(role_name="CASHIER")
    await db_session.execute(
        update(User).where(User.id == cashier["id"]).values(full_name="Cajera original")
    )
    await db_session.flush()
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
    assert completed["cashier_name"] == "Cajera original"

    await db_session.execute(
        update(Product)
        .where(Product.id == product["id"])
        .values(
            sku="HISTORY-IDENTITY-CHANGED",
            name="Nombre cambiado",
            category_id=replacement_category["id"],
            cost=Decimal("99.00"),
        )
    )
    await db_session.execute(
        update(User).where(User.id == cashier["id"]).values(full_name="Cajera cambiada")
    )
    await db_session.flush()

    reread = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert reread["lines"][0]["product_sku"] == "HISTORY-IDENTITY-1"
    assert reread["lines"][0]["product_name"] == "Nombre original"
    assert reread["cashier_name"] == "Cajera original"

    ticket = (await client.post(f"/api/v1/sales/{sale['id']}/tickets")).json()
    assert "Nombre original" in ticket["rendered_text"]
    assert "Nombre cambiado" not in ticket["rendered_text"]
    assert "Cajera original" in ticket["rendered_text"]
    assert "Cajera cambiada" not in ticket["rendered_text"]

    await login(role_name="ADMIN")
    report = await client.post(
        "/api/v1/reports/run",
        json={
            "subject": "SALES",
            "dimensions": ["product", "category", "cashier"],
            "metrics": ["revenue"],
            "filters": {"product_id": product["id"]},
        },
    )
    assert report.status_code == 200
    row = report.json()["rows"][0]
    assert row["product_sku"] == "HISTORY-IDENTITY-1"
    assert row["product_name"] == "Nombre original"
    assert row["category_name"] == "Categoría original"
    assert row["cashier_name"] == "Cajera original"

    returned = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": completed["lines"][0]["id"],
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "1",
                }
            ],
            "refund_method": "CASH",
        },
    )
    assert returned.status_code == 201
    returned_line = returned.json()["lines"][0]
    assert returned_line["product_sku"] == "HISTORY-IDENTITY-1"
    assert returned_line["product_name"] == "Nombre original"

    movements = (
        await client.get("/api/v1/stock-movements", params={"product_id": product["id"]})
    ).json()
    return_movement = next(item for item in movements if item["reference_type"] == "return")
    assert Decimal(return_movement["unit_cost"]) == Decimal("2.50")


async def test_completed_barcode_sale_keeps_package_factor_and_price_snapshots(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "HISTORY-BOX-BARCODE",
                "name": "Leche histórica",
                "base_unit_name": "UNIDAD",
                "base_barcode": "8412345200013",
                "cost": "0.50",
                "list_price": "1.20",
                "tax_rate": "0",
            },
        )
    ).json()
    product = (
        await client.post(
            f"/api/v1/products/{product['id']}/packages",
            json={"name": "CAJA 6", "factor": "6", "barcode": "8412345200068"},
        )
    ).json()
    box = next(package for package in product["packages"] if not package["is_base"])
    warehouse_id, location_id = await _new_location(client, "Histórico formatos")
    stocked = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "12",
            "unit_cost": "0.50",
        },
    )
    assert stocked.status_code == 201
    await login(role_name="CASHIER")
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()
    added = await client.post(
        f"/api/v1/sales/{sale['id']}/lines/by-barcode",
        json={"barcode": "8412345200068"},
    )
    assert added.status_code == 201
    completed = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": added.json()["total"]}]},
    )
    assert completed.status_code == 200

    await db_session.execute(
        update(ProductPackage)
        .where(ProductPackage.id == box["id"])
        .values(name="CAJA 10 ACTUAL", factor=Decimal("10"))
    )
    await db_session.execute(
        update(Product).where(Product.id == product["id"]).values(list_price=Decimal("99"))
    )
    await db_session.flush()

    historical_line = (await client.get(f"/api/v1/sales/{sale['id']}")).json()["lines"][0]
    assert historical_line["package_id"] == box["id"]
    assert historical_line["package_name"] == "CAJA 6"
    assert historical_line["package_factor"] == "6.000000"
    assert historical_line["quantity_packages"] == "1.000000"
    assert historical_line["quantity_base"] == "6.000000"
    assert historical_line["unit_price"] == "1.200000"
    assert historical_line["package_price"] == "7.200000"
    assert historical_line["total"] == "7.200000"
