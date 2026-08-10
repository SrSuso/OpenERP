"""Dashboards (phase 16): configurable widgets over a whitelisted set of
metrics (rule 13 — no arbitrary SQL, ever)."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _new_warehouse(client: AsyncClient) -> tuple[int, int]:
    """A brand-new warehouse/location, unique to the calling test.

    Any metric assertion that counts/sums *everything visible* rather than
    one specific id must scope to a warehouse like this one, not the
    shared "Tienda principal" — a handful of other tests in the suite
    (the real-concurrency ones, ``committing_sessionmaker``) commit for
    real rather than rolling back, so data can outlive its own test and
    leak into "Tienda principal" totals depending on execution order.
    """
    warehouse = (
        await client.post(
            "/api/v1/warehouses", json={"name": f"Dashboard test {uuid.uuid4().hex[:8]}"}
        )
    ).json()
    location = (
        await client.post(
            f"/api/v1/warehouses/{warehouse['id']}/locations", json={"name": "Almacén"}
        )
    ).json()
    return warehouse["id"], location["id"]


async def _create_product(
    client: AsyncClient, sku: str = "DASH-TEST-1", **overrides: Any
) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": "Producto de dashboard",
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


async def _stock(
    client: AsyncClient, *, product_id: int, warehouse_id: int, location_id: int, quantity: str
) -> None:
    response = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": quantity,
            "unit_cost": "2.00",
        },
    )
    assert response.status_code == 201


async def _completed_sale(
    client: AsyncClient,
    *,
    product: dict[str, Any],
    quantity: str = "1",
    location: tuple[int, int] | None = None,
) -> dict[str, Any]:
    warehouse_id, location_id = location or await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="1000",
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


async def _create_dashboard(client: AsyncClient, name: str = "Panel") -> dict[str, Any]:
    response = await client.post("/api/v1/dashboards", json={"name": name})
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


TODAY = datetime.now(UTC).date().isoformat()


async def test_list_metrics_describes_every_whitelisted_metric(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get("/api/v1/dashboard-metrics")

    assert response.status_code == 200
    keys = {m["key"] for m in response.json()}
    assert keys == {
        "sales_over_time",
        "top_products",
        "stock_value",
        "low_stock_count",
        # Montado con el constructor de informes, no una consulta fija más.
        "report",
    }


async def test_create_dashboard_and_add_a_widget(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    dashboard = await _create_dashboard(client)

    response = await client.post(
        f"/api/v1/dashboards/{dashboard['id']}/widgets",
        json={
            "metric": "stock_value",
            "title": "Valor de inventario",
            "params": {},
            "chart_type": "kpi",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert len(body["widgets"]) == 1
    assert body["widgets"][0]["metric"] == "stock_value"


async def test_adding_a_widget_with_params_that_do_not_fit_the_metric_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    dashboard = await _create_dashboard(client)

    response = await client.post(
        f"/api/v1/dashboards/{dashboard['id']}/widgets",
        json={
            "metric": "sales_over_time",
            "title": "Ventas",
            "params": {},  # missing required date_from/date_to
            "chart_type": "line",
        },
    )

    assert response.status_code == 422


async def test_adding_a_widget_with_an_unknown_metric_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    dashboard = await _create_dashboard(client)

    response = await client.post(
        f"/api/v1/dashboards/{dashboard['id']}/widgets",
        json={
            "metric": "drop_table_products",
            "title": "x",
            "params": {},
            "chart_type": "kpi",
        },
    )

    assert response.status_code == 422


async def test_removing_a_widget(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    dashboard = await _create_dashboard(client)
    added = (
        await client.post(
            f"/api/v1/dashboards/{dashboard['id']}/widgets",
            json={"metric": "stock_value", "title": "x", "params": {}, "chart_type": "kpi"},
        )
    ).json()
    widget_id = added["widgets"][0]["id"]

    response = await client.delete(f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget_id}")

    assert response.status_code == 200
    assert response.json()["widgets"] == []


async def test_sales_over_time_aggregates_completed_sales_by_day(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _new_warehouse(client)
    product = await _create_product(client, sku="DASH-SALES", list_price="10.00", tax_rate="0")
    await _completed_sale(
        client, product=product, quantity="2", location=(warehouse_id, location_id)
    )
    await _completed_sale(
        client, product=product, quantity="3", location=(warehouse_id, location_id)
    )
    dashboard = await _create_dashboard(client)
    widget = (
        await client.post(
            f"/api/v1/dashboards/{dashboard['id']}/widgets",
            json={
                "metric": "sales_over_time",
                "title": "Ventas",
                "params": {"date_from": TODAY, "date_to": TODAY, "warehouse_id": warehouse_id},
                "chart_type": "line",
            },
        )
    ).json()["widgets"][0]

    response = await client.get(f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data")

    assert response.status_code == 200
    rows = response.json()["data"]
    assert len(rows) == 1
    assert rows[0]["date"] == TODAY
    assert rows[0]["sales_count"] == 2
    assert rows[0]["total"] == "50.000000"  # (2 + 3) * 10.00


async def test_sales_over_time_respects_prices_include_tax(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """``PricingSettings.prices_include_tax`` (app.pricing.models) is read
    live by ``app.dashboards.metrics._line_total_expr``'s scalar subquery
    — revenue here has to match what checkout actually charged, not
    12.10€ plus 21% tax on top of it."""
    await login(role_name="ADMIN")
    default_formula = (await client.get("/api/v1/pricing/settings")).json()["formula"]
    assert (
        await client.put(
            "/api/v1/pricing/settings",
            json={"formula": default_formula, "prices_include_tax": True},
        )
    ).status_code == 200
    try:
        warehouse_id, location_id = await _new_warehouse(client)
        product = await _create_product(
            client, sku="DASH-TAX-INCL", list_price="12.10", tax_rate="21"
        )
        await _completed_sale(
            client, product=product, quantity="1", location=(warehouse_id, location_id)
        )
        dashboard = await _create_dashboard(client)
        widget = (
            await client.post(
                f"/api/v1/dashboards/{dashboard['id']}/widgets",
                json={
                    "metric": "sales_over_time",
                    "title": "Ventas",
                    "params": {
                        "date_from": TODAY,
                        "date_to": TODAY,
                        "warehouse_id": warehouse_id,
                    },
                    "chart_type": "line",
                },
            )
        ).json()["widgets"][0]

        response = await client.get(
            f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data"
        )

        assert response.status_code == 200
        rows = response.json()["data"]
        assert rows[0]["total"] == "12.100000"
    finally:
        await login(role_name="ADMIN")
        await client.put(
            "/api/v1/pricing/settings",
            json={
                "formula": (await client.get("/api/v1/pricing/settings")).json()["formula"],
                "prices_include_tax": False,
            },
        )


async def test_top_products_orders_by_revenue_by_default(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _new_warehouse(client)
    cheap = await _create_product(
        client, sku="DASH-CHEAP", name="Barato pero mucho", list_price="1.00", tax_rate="0"
    )
    pricey = await _create_product(
        client, sku="DASH-PRICEY", name="Caro pero poco", list_price="100.00", tax_rate="0"
    )
    await _completed_sale(
        client, product=cheap, quantity="50", location=(warehouse_id, location_id)
    )
    await _completed_sale(
        client, product=pricey, quantity="1", location=(warehouse_id, location_id)
    )
    dashboard = await _create_dashboard(client)
    widget = (
        await client.post(
            f"/api/v1/dashboards/{dashboard['id']}/widgets",
            json={
                "metric": "top_products",
                "title": "Top",
                "params": {
                    "date_from": TODAY,
                    "date_to": TODAY,
                    "order_by": "revenue",
                    "warehouse_id": warehouse_id,
                },
                "chart_type": "bar",
            },
        )
    ).json()["widgets"][0]

    response = await client.get(f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data")

    rows = response.json()["data"]
    assert rows[0]["product_sku"] == "DASH-PRICEY"  # 100 revenue > 50 revenue


async def test_top_products_can_order_by_quantity_instead(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _new_warehouse(client)
    cheap = await _create_product(
        client, sku="DASH-CHEAP-2", name="Barato pero mucho", list_price="1.00", tax_rate="0"
    )
    pricey = await _create_product(
        client, sku="DASH-PRICEY-2", name="Caro pero poco", list_price="100.00", tax_rate="0"
    )
    await _completed_sale(
        client, product=cheap, quantity="50", location=(warehouse_id, location_id)
    )
    await _completed_sale(
        client, product=pricey, quantity="1", location=(warehouse_id, location_id)
    )
    dashboard = await _create_dashboard(client)
    widget = (
        await client.post(
            f"/api/v1/dashboards/{dashboard['id']}/widgets",
            json={
                "metric": "top_products",
                "title": "Top",
                "params": {
                    "date_from": TODAY,
                    "date_to": TODAY,
                    "order_by": "quantity",
                    "warehouse_id": warehouse_id,
                },
                "chart_type": "bar",
            },
        )
    ).json()["widgets"][0]

    response = await client.get(f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data")

    rows = response.json()["data"]
    assert rows[0]["product_sku"] == "DASH-CHEAP-2"  # 50 units > 1 unit


async def test_stock_value_sums_quantity_times_cost(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _new_warehouse(client)
    product = await _create_product(client, sku="DASH-STOCKVAL", cost="3.00")
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    dashboard = await _create_dashboard(client)
    widget = (
        await client.post(
            f"/api/v1/dashboards/{dashboard['id']}/widgets",
            json={
                "metric": "stock_value",
                "title": "Valor",
                "params": {"warehouse_id": warehouse_id},
                "chart_type": "kpi",
            },
        )
    ).json()["widgets"][0]

    response = await client.get(f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data")

    assert response.json()["data"]["stock_value"] == "30.000000"  # 10 * 3.00


async def test_low_stock_count_counts_products_below_their_minimum(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    low = await _create_product(client, sku="DASH-LOW", min_stock="100")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=low["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="5",
    )
    ok = await _create_product(client, sku="DASH-OK", min_stock="1")
    await _stock(
        client,
        product_id=ok["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="50",
    )
    dashboard = await _create_dashboard(client)
    widget = (
        await client.post(
            f"/api/v1/dashboards/{dashboard['id']}/widgets",
            json={
                "metric": "low_stock_count",
                "title": "Stock bajo",
                "params": {},
                "chart_type": "kpi",
            },
        )
    ).json()["widgets"][0]

    response = await client.get(f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data")

    assert response.json()["data"]["low_stock_count"] >= 1


async def test_date_from_after_date_to_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    dashboard = await _create_dashboard(client)
    widget = (
        await client.post(
            f"/api/v1/dashboards/{dashboard['id']}/widgets",
            json={
                "metric": "sales_over_time",
                "title": "x",
                "params": {"date_from": "2026-08-08", "date_to": "2026-01-01"},
                "chart_type": "line",
            },
        )
    ).json()["widgets"][0]

    response = await client.get(f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data")

    assert response.status_code == 422


async def test_widget_data_for_a_missing_widget_is_404(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    dashboard = await _create_dashboard(client)

    response = await client.get(f"/api/v1/dashboards/{dashboard['id']}/widgets/999999/data")

    assert response.status_code == 404


async def test_cashier_cannot_read_or_manage_dashboards(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/dashboards")).status_code == 403
    assert (await client.post("/api/v1/dashboards", json={"name": "x"})).status_code == 403


async def test_manager_can_manage_dashboards(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="MANAGER")

    response = await client.post("/api/v1/dashboards", json={"name": "Panel gerencia"})

    assert response.status_code == 201


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/dashboards")

    assert response.status_code == 401


async def test_a_widget_can_be_built_with_the_report_builder(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Graficar algo que no está en las cuatro métricas fijas, eligiendo
    sujeto/agrupación/medida — sin abrir una segunda vía de consultas: se
    valida contra la misma lista blanca que los informes."""
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _new_warehouse(client)
    product = await _create_product(client, sku="DASH-REPORT", list_price="10.00", tax_rate="0")
    await _completed_sale(
        client, product=product, quantity="2", location=(warehouse_id, location_id)
    )
    dashboard = await _create_dashboard(client)
    widget = (
        await client.post(
            f"/api/v1/dashboards/{dashboard['id']}/widgets",
            json={
                "metric": "report",
                "title": "Ventas por producto",
                "params": {
                    "subject": "SALES",
                    "dimensions": ["product"],
                    "metrics": ["quantity", "revenue"],
                    "filters": {"warehouse_id": warehouse_id},
                },
                "chart_type": "bar",
            },
        )
    ).json()["widgets"][0]

    response = await client.get(f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["columns"] == ["product_sku", "product_name", "quantity", "revenue"]
    assert data["rows"][0]["product_sku"] == product["sku"]


async def test_a_report_widget_with_an_invented_dimension_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    dashboard = await _create_dashboard(client)

    response = await client.post(
        f"/api/v1/dashboards/{dashboard['id']}/widgets",
        json={
            "metric": "report",
            "title": "Inventada",
            "params": {"subject": "SALES", "dimensions": ["no_existe"], "metrics": ["quantity"]},
            "chart_type": "bar",
        },
    )

    # Si cuela al guardar, tiene que caer al ejecutarse — nunca llegar a SQL.
    if response.status_code == 201:
        widget = response.json()["widgets"][-1]
        data = await client.get(f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data")
        assert data.status_code == 422
    else:
        assert response.status_code == 422
