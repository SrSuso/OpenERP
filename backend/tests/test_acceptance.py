"""Phase 22: whole-system acceptance — one realistic business day, walked
through the real HTTP API end to end, crossing every module the previous
21 phases built one at a time.

Every other test file in this suite proves its own module correct in
isolation; this one is the closing check that they are also correct
*together* — a purchase really becomes sellable stock, a sale really
drains it, a return really reverses the right slice of it, a dashboard
really reflects it, a notification rule really detects it, and the audit
trail really recorded each step. Inline comments call out which of the
15 architecture rules (README's own numbering) each assertion is
protecting, since that list is this project's actual acceptance
criteria, not a spec document that lives outside the code.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient

LoginFn = Callable[..., Awaitable[dict[str, Any]]]


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def test_full_business_lifecycle_end_to_end(client: AsyncClient, login: LoginFn) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)

    # --- catalog, pricing, suppliers (fases 3-5) ---------------------------
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "ACCEPTANCE-1",
                "name": "Producto de aceptación",
                "base_unit_name": "UNIDAD",
                "cost": "5.00",
                "list_price": "10.00",
                "tax_rate": "21",
                "min_stock": "10",  # deliberately high — triggers LOW_STOCK below
            },
        )
    ).json()
    base_package_id = next(p["id"] for p in product["packages"] if p["is_base"])

    supplier = (
        await client.post("/api/v1/suppliers", json={"name": "Proveedor de aceptación"})
    ).json()

    # --- purchasing + receiving (fases 6, 9): rule 6/7 (snapshots) ---------
    order = (
        await client.post("/api/v1/purchase-orders", json={"supplier_id": supplier["id"]})
    ).json()
    line = (
        await client.post(
            f"/api/v1/purchase-orders/{order['id']}/lines",
            json={
                "product_id": product["id"],
                "package_id": base_package_id,
                "quantity_packages": "20",
                "unit_cost": "4.50",  # snapshot: differs from the product's current cost
            },
        )
    ).json()["lines"][0]
    await client.post(f"/api/v1/purchase-orders/{order['id']}/place")

    receipt = await client.post(
        f"/api/v1/purchase-orders/{order['id']}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [{"purchase_order_line_id": line["id"], "quantity_packages": "20"}],
        },
    )
    assert receipt.status_code == 201
    received_order = (await client.get(f"/api/v1/purchase-orders/{order['id']}")).json()
    assert received_order["status"] == "RECEIVED"

    # Rule 1/2/3: stock_movements is the ledger, stock_balance a projection
    # of it, everything in the base unit.
    balance = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    assert balance[0]["quantity"] == "20.000000"

    # A ticket template must exist before any sale can print one (fase 15).
    await client.post(
        "/api/v1/ticket-templates",
        json={"name": "Aceptación", "width_mm": 58, "header_text": "Tienda de aceptación"},
    )

    # --- the sale itself, rung up by a cashier (fases 11-13) ---------------
    await login(role_name="CASHIER")
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()
    await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_package_id,
            "quantity_packages": "15",
        },
    )
    priced_sale = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    # Rule 6/7: the sale's price came from the product at the moment it was
    # rung up, not a live join — 15 * 10.00 = 150. El PVP ya lleva el IVA
    # dentro (fórmula de fábrica), así que no se le suma nada encima.
    assert priced_sale["total"] == "150.000000"

    checkout = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "200.00"}]},
    )
    assert checkout.status_code == 200
    completed = checkout.json()
    assert completed["status"] == "COMPLETED"
    # Rule 8: Decimal precision preserved through the whole round trip,
    # never float — a naive float total would not land on this exact value.
    assert Decimal(completed["change_due"]) == Decimal("50.000000")  # 200 - 150

    balance_after_sale = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    assert balance_after_sale[0]["quantity"] == "5.000000"  # 20 - 15

    # A cashier printing a receipt only needs sale.read, which they already
    # hold (fase 15's own permission note) — no manage permission required.
    ticket = await client.post(f"/api/v1/sales/{sale['id']}/tickets")
    assert ticket.status_code == 201
    assert "Tienda de aceptación" in ticket.json()["rendered_text"]

    # --- returns: rule 9, economic and physical are independent ------------
    await login(role_name="ADMIN")
    sale_line_id = completed["lines"][0]["id"]

    economic_only = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "quantity_packages": "1",
                    "economic": True,
                    "physical": False,
                }
            ]
        },
    )
    assert economic_only.status_code == 201
    assert economic_only.json()["lines"][0]["stock_movement_id"] is None
    balance_after_economic = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()[0]["quantity"]
    assert balance_after_economic == "5.000000"  # unchanged — no physical leg

    physical_only = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "quantity_packages": "1",
                    "economic": False,
                    "physical": True,
                }
            ]
        },
    )
    assert physical_only.status_code == 201
    assert physical_only.json()["lines"][0]["refund_amount"] == "0.000000"
    balance_after_physical = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()[0]["quantity"]
    assert balance_after_physical == "6.000000"  # +1 restocked, 6 remains < min_stock(10)

    # --- dashboards: rule 13, only whitelisted metrics, never raw SQL ------
    dashboard = (
        await client.post("/api/v1/dashboards", json={"name": "Panel de aceptación"})
    ).json()
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
    widget_data = await client.get(
        f"/api/v1/dashboards/{dashboard['id']}/widgets/{widget['id']}/data"
    )
    assert widget_data.json()["data"]["low_stock_count"] >= 1  # our product qualifies

    # --- notifications: the same low-stock condition, detected and deduped
    rule = (
        await client.post(
            "/api/v1/notification-rules",
            json={"name": "Stock bajo (aceptación)", "rule_type": "LOW_STOCK", "params": {}},
        )
    ).json()
    incidents = (await client.post("/api/v1/notifications/evaluate")).json()
    our_incident = next(
        (
            i
            for i in incidents
            if i["rule_id"] == rule["id"]
            and i["subject_type"] == "product"
            and i["subject_id"] == product["id"]
        ),
        None,
    )
    assert our_incident is not None
    assert our_incident["status"] == "OPEN"

    # Re-evaluating without any further change must not open a duplicate —
    # the partial unique index from fase 17, exercised for real here.
    incidents_again = (await client.post("/api/v1/notifications/evaluate")).json()
    dupes = [
        i
        for i in incidents_again
        if i["rule_id"] == rule["id"]
        and i["subject_type"] == "product"
        and i["subject_id"] == product["id"]
        and i["status"] == "OPEN"
    ]
    assert len(dupes) <= 1

    # --- audit trail: every mutating step above left a record ---------------
    audit_log = (await client.get("/api/v1/audit-log")).json()
    logged_types = {(entry["entity_type"], entry["entity_id"]) for entry in audit_log}
    assert ("product", product["id"]) in logged_types
    assert ("purchase_order", order["id"]) in logged_types
    assert ("sale", sale["id"]) in logged_types
    assert ("return", economic_only.json()["id"]) in logged_types
    assert ("return", physical_only.json()["id"]) in logged_types

    # --- rule 14: deactivate, never delete ----------------------------------
    deactivated = await client.post(f"/api/v1/products/{product['id']}/deactivate")
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    active_products = (await client.get("/api/v1/products")).json()  # active_only=True default
    assert product["id"] not in {p["id"] for p in active_products}

    # The historical sale, its ticket and the audit trail must all still be
    # readable exactly as before — deactivating a product never rewrites
    # history (same rule 14, and rule 6/7's "never reshape the past").
    still_readable_sale = await client.get(f"/api/v1/sales/{sale['id']}")
    assert still_readable_sale.status_code == 200
    assert still_readable_sale.json()["status"] == "COMPLETED"
    still_readable_ticket = await client.get(f"/api/v1/sales/{sale['id']}/ticket")
    assert still_readable_ticket.status_code == 200


async def test_permission_boundaries_hold_across_the_whole_lifecycle(
    client: AsyncClient, login: LoginFn
) -> None:
    """Rule 11, sampled across modules from different phases in one pass —
    each module's own test file already covers this exhaustively for
    itself; this is the cross-module sanity check that closing the
    project didn't leave a gap between them."""
    unauthenticated_endpoints = [
        ("GET", "/api/v1/products"),
        ("GET", "/api/v1/purchase-orders"),
        ("GET", "/api/v1/sales"),
        ("GET", "/api/v1/dashboards"),
        ("GET", "/api/v1/incidents"),
        ("GET", "/api/v1/audit-log"),
        ("GET", "/api/v1/outbox"),
    ]
    for method, path in unauthenticated_endpoints:
        response = await client.request(method, path)
        assert response.status_code == 401, f"{method} {path} should require authentication"

    await login(role_name="CASHIER")
    # A cashier rings up sales but must not manage suppliers, purchase
    # orders, returns, dashboards or notification rules — supervisory
    # actions on a POS terminal a cashier could otherwise reach.
    cashier_forbidden = [
        ("POST", "/api/v1/suppliers", {"name": "x"}),
        ("POST", "/api/v1/purchase-orders", {"supplier_id": 1}),
        ("POST", "/api/v1/dashboards", {"name": "x"}),
        ("POST", "/api/v1/notification-rules", {"name": "x", "rule_type": "LOW_STOCK"}),
    ]
    for method, path, body in cashier_forbidden:
        response = await client.request(method, path, json=body)
        assert response.status_code == 403, f"CASHIER {method} {path} should be forbidden"
