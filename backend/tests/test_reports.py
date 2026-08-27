"""Report builder (phase 19): pick a subject, dimensions, metrics and
filters from a fixed whitelist (rule 13 — no arbitrary SQL, ever)."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sales.models import Sale


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_product(client: AsyncClient, **overrides: Any) -> dict[str, Any]:
    payload = {
        "sku": f"REPORT-TEST-{uuid.uuid4().hex[:8]}",
        "name": "Producto de informe",
        "base_unit_name": "UNIDAD",
        "cost": "2.00",
        "list_price": "10.00",
        "tax_rate": "0",
    }
    payload.update(overrides)
    response = await client.post("/api/v1/products", json=payload)
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def _completed_sale(
    client: AsyncClient, *, product: dict[str, Any], quantity: str = "3"
) -> dict[str, Any]:
    warehouse_id, location_id = await _default_location(client)
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "1000",
            "unit_cost": "2.00",
        },
    )
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    added = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={
                "product_id": product["id"],
                "package_id": base_id,
                "quantity_packages": quantity,
            },
        )
    ).json()
    completed = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": added["total"]}]},
    )
    assert completed.status_code == 200
    result: dict[str, Any] = completed.json()
    return result


async def test_list_subjects_describes_every_whitelisted_subject(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get("/api/v1/report-subjects")

    assert response.status_code == 200
    subjects = {s["subject"] for s in response.json()}
    assert subjects == {"SALES", "PURCHASES", "INVENTORY_MOVEMENTS"}
    sales = next(s for s in response.json() if s["subject"] == "SALES")
    assert {d["key"] for d in sales["dimensions"]} >= {"date", "product", "category"}
    assert {m["key"] for m in sales["metrics"]} >= {"quantity", "revenue"}


async def test_run_sales_report_groups_by_product_and_sums_quantity_and_revenue(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, list_price="10.00")
    sale = await _completed_sale(client, product=product, quantity="3")

    response = await client.post(
        "/api/v1/reports/run",
        json={
            "subject": "SALES",
            "dimensions": ["product"],
            "metrics": ["quantity", "revenue", "tickets"],
            "filters": {"product_id": product["id"]},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["columns"] == ["product_name", "quantity", "revenue", "tickets"]
    assert len(body["rows"]) == 1
    row = body["rows"][0]
    assert row["product_name"] == product["name"]
    assert row["quantity"] == "3.000000"
    assert row["revenue"] == str(sale["total"])
    assert row["tickets"] == 1


async def test_sales_dates_use_the_business_calendar_not_the_postgresql_timezone(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    assert (
        await client.put(
            "/api/v1/settings/options",
            json={"values": {"business.timezone": "Europe/Madrid"}},
        )
    ).status_code == 200
    product = await _create_product(client)
    before_midnight = await _completed_sale(client, product=product, quantity="1")
    after_midnight = await _completed_sale(client, product=product, quantity="1")
    await db_session.execute(
        update(Sale)
        .where(Sale.id == before_midnight["id"])
        .values(completed_at=datetime(2026, 8, 12, 21, 59, tzinfo=UTC))
    )
    await db_session.execute(
        update(Sale)
        .where(Sale.id == after_midnight["id"])
        .values(completed_at=datetime(2026, 8, 12, 22, 1, tzinfo=UTC))
    )
    # The old DATE(timestamptz) changed result with this session setting.
    # The new timezone(text, timestamptz) expression is explicit.
    await db_session.execute(text("SET LOCAL TIME ZONE 'Pacific/Honolulu'"))
    await db_session.flush()

    grouped = await client.post(
        "/api/v1/reports/run",
        json={
            "subject": "SALES",
            "dimensions": ["date"],
            "metrics": ["tickets"],
            "filters": {"product_id": product["id"]},
        },
    )
    filtered = await client.post(
        "/api/v1/reports/run",
        json={
            "subject": "SALES",
            "dimensions": ["date"],
            "metrics": ["tickets"],
            "filters": {
                "product_id": product["id"],
                "date_from": "2026-08-13",
                "date_to": "2026-08-13",
            },
        },
    )

    assert grouped.status_code == 200
    assert grouped.json()["rows"] == [
        {"date": "2026-08-12", "tickets": 1},
        {"date": "2026-08-13", "tickets": 1},
    ]
    assert filtered.status_code == 200
    assert filtered.json()["rows"] == [{"date": "2026-08-13", "tickets": 1}]


async def test_sales_report_revenue_respects_prices_include_tax(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """``PricingSettings.prices_include_tax`` (app.pricing.models) is read
    live by ``app.reports.rules._sales_line_total``'s scalar subquery —
    revenue has to match what checkout actually charged, not 12.10€ plus
    21% tax on top of it."""
    await login(role_name="ADMIN")
    default_formula = (await client.get("/api/v1/pricing/settings")).json()["formula"]
    assert (
        await client.put(
            "/api/v1/pricing/settings",
            json={"formula": default_formula, "prices_include_tax": True},
        )
    ).status_code == 200
    try:
        product = await _create_product(client, list_price="12.10", tax_rate="21")
        await _completed_sale(client, product=product, quantity="1")

        response = await client.post(
            "/api/v1/reports/run",
            json={
                "subject": "SALES",
                "dimensions": ["product"],
                "metrics": ["revenue"],
                "filters": {"product_id": product["id"]},
            },
        )

        assert response.status_code == 200
        assert response.json()["rows"][0]["revenue"] == "12.100000"
    finally:
        await login(role_name="ADMIN")
        await client.put(
            "/api/v1/pricing/settings",
            json={
                "formula": (await client.get("/api/v1/pricing/settings")).json()["formula"],
                "prices_include_tax": False,
            },
        )


async def test_run_report_with_no_dimensions_returns_one_aggregate_row(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client)
    await _completed_sale(client, product=product, quantity="2")

    response = await client.post(
        "/api/v1/reports/run",
        json={
            "subject": "SALES",
            "dimensions": [],
            "metrics": ["quantity"],
            "filters": {"product_id": product["id"]},
        },
    )

    assert response.status_code == 200
    assert len(response.json()["rows"]) == 1


async def test_run_report_rejects_an_unknown_dimension_or_metric(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    bad_dimension = await client.post(
        "/api/v1/reports/run",
        json={"subject": "SALES", "dimensions": ["not_a_real_dimension"], "metrics": ["quantity"]},
    )
    assert bad_dimension.status_code == 422

    bad_metric = await client.post(
        "/api/v1/reports/run",
        json={"subject": "SALES", "dimensions": [], "metrics": ["not_a_real_metric"]},
    )
    assert bad_metric.status_code == 422


async def test_run_report_requires_at_least_one_metric(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/reports/run", json={"subject": "SALES", "dimensions": ["date"], "metrics": []}
    )

    assert response.status_code == 422


async def test_save_list_run_and_delete_a_report_definition(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client)
    await _completed_sale(client, product=product, quantity="1")

    created = await client.post(
        "/api/v1/report-definitions",
        json={
            "name": "Ventas por producto",
            "subject": "SALES",
            "dimensions": ["product"],
            "metrics": ["quantity"],
            "filters": {"product_id": product["id"]},
        },
    )
    assert created.status_code == 201
    definition_id = created.json()["id"]

    listed = await client.get("/api/v1/report-definitions")
    assert definition_id in {d["id"] for d in listed.json()}

    run = await client.post(f"/api/v1/report-definitions/{definition_id}/run")
    assert run.status_code == 200
    assert run.json()["rows"][0]["quantity"] == "1.000000"

    deleted = await client.delete(f"/api/v1/report-definitions/{definition_id}")
    assert deleted.status_code == 204

    listed_again = await client.get("/api/v1/report-definitions")
    assert definition_id not in {d["id"] for d in listed_again.json()}


async def test_cashier_cannot_read_or_manage_reports(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/report-subjects")).status_code == 403
    assert (
        await client.post(
            "/api/v1/reports/run",
            json={"subject": "SALES", "dimensions": [], "metrics": ["quantity"]},
        )
    ).status_code == 403
