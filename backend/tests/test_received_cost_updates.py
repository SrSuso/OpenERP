"""B10: a receipt proposes its base-unit cost; pricing changes only on confirmation."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any, cast

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import StockMovement
from app.rbac.models import Permission, Role


async def _location(client: AsyncClient) -> tuple[int, int]:
    warehouse = next(
        w
        for w in (await client.get("/api/v1/warehouses")).json()
        if w["name"] == "Tienda principal"
    )
    location = next(
        loc
        for loc in (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
        if loc["name"] == "Almacén"
    )
    return warehouse["id"], location["id"]


async def _product(client: AsyncClient, *, sku: str, **overrides: Any) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": sku,
        "base_unit_name": "UNIDAD",
        "cost": "1.00",
        "list_price": "2.00",
    }
    payload.update(overrides)
    response = await client.post("/api/v1/products", json=payload)
    assert response.status_code == 201
    return cast(dict[str, Any], response.json())


async def _ordered_receipt(
    client: AsyncClient,
    *,
    product: dict[str, Any],
    package_id: int | None = None,
    quantity_packages: str = "10",
    ordered_quantity_packages: str | None = None,
    unit_cost: str = "1.20",
) -> dict[str, Any]:
    supplier = await client.post(
        "/api/v1/suppliers", json={"name": f"Supplier {product['sku']} {unit_cost}"}
    )
    order = await client.post(
        "/api/v1/purchase-orders", json={"supplier_id": supplier.json()["id"]}
    )
    package_id = package_id or next(
        package["id"] for package in product["packages"] if package["is_base"]
    )
    line = await client.post(
        f"/api/v1/purchase-orders/{order.json()['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": package_id,
            "quantity_packages": ordered_quantity_packages or quantity_packages,
            "unit_cost": unit_cost,
        },
    )
    assert line.status_code == 201
    await client.post(f"/api/v1/purchase-orders/{order.json()['id']}/place")
    warehouse_id, location_id = await _location(client)
    receipt = await client.post(
        f"/api/v1/purchase-orders/{order.json()['id']}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [
                {
                    "purchase_order_line_id": line.json()["lines"][0]["id"],
                    "quantity_packages": quantity_packages,
                }
            ],
        },
    )
    assert receipt.status_code == 201
    return cast(dict[str, Any], receipt.json())


async def _apply(client: AsyncClient, receipt: dict[str, Any]) -> Any:
    proposal = receipt["cost_proposals"][0]
    return await client.post(
        f"/api/v1/goods-receipts/{receipt['id']}/apply-costs",
        json={
            "lines": [
                {
                    "receipt_line_id": proposal["receipt_line_id"],
                    "expected_current_cost": proposal["current_catalog_cost"],
                }
            ]
        },
    )


async def test_receipt_keeps_received_cost_and_only_proposes_catalog_change(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    product = await _product(client, sku="B10-DIVERGENCE")
    receipt = await _ordered_receipt(client, product=product, unit_cost="1.20")

    # Physical stock and its ledger value use the received base-unit cost,
    # while the commercial catalog remains untouched until confirmation.
    balances = await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    assert balances.json()[0]["quantity"] == "10.000000"
    movement = await db_session.get(StockMovement, receipt["lines"][0]["stock_movement_id"])
    assert movement is not None and movement.unit_cost == Decimal("1.200000")
    current = await client.get(f"/api/v1/products/{product['id']}")
    assert current.json()["cost"] == "1.000000"
    assert current.json()["list_price"] == "2.000000"
    assert receipt["cost_proposals"] == [
        {
            "receipt_line_id": receipt["lines"][0]["id"],
            "product_id": product["id"],
            "product_sku": "B10-DIVERGENCE",
            "product_name": "B10-DIVERGENCE",
            "current_catalog_cost": "1.000000",
            "received_unit_cost": "1.200000",
            "difference": "0.200000",
        }
    ]


async def test_confirmed_received_cost_uses_canonical_pricing_and_is_idempotent(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _product(client, sku="B10-FORMULA")
    formula = await client.put(
        f"/api/v1/products/{product['id']}/pricing/formula", json={"price_formula": "cost * 2"}
    )
    assert formula.json()["list_price"] == "2.000000"
    receipt = await _ordered_receipt(client, product=product, unit_cost="1.20")

    applied = await _apply(client, receipt)
    assert applied.status_code == 200
    current = await client.get(f"/api/v1/products/{product['id']}")
    assert current.json()["cost"] == "1.200000"
    assert current.json()["list_price"] == "2.400000"
    assert applied.json()["cost_proposals"] == []

    # The natural replay has the same persisted value and cannot drift price.
    replay = await client.post(
        f"/api/v1/goods-receipts/{receipt['id']}/apply-costs",
        json={
            "lines": [
                {
                    "receipt_line_id": receipt["lines"][0]["id"],
                    "expected_current_cost": "1.000000",
                }
            ]
        },
    )
    assert replay.status_code == 200
    assert (await client.get(f"/api/v1/products/{product['id']}")).json()[
        "list_price"
    ] == "2.400000"


async def test_old_cost_proposal_cannot_overwrite_new_catalog_cost(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _product(client, sku="B10-STALE")
    receipt = await _ordered_receipt(client, product=product, unit_cost="1.20")
    await client.patch(f"/api/v1/products/{product['id']}/pricing", json={"cost": "1.30"})

    stale = await _apply(client, receipt)
    assert stale.status_code == 409
    assert (await client.get(f"/api/v1/products/{product['id']}")).json()["cost"] == "1.300000"


async def test_box_cost_is_converted_once_to_base_unit(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _product(client, sku="B10-BOX")
    await client.put(
        f"/api/v1/products/{product['id']}/pricing/formula", json={"price_formula": "cost * 2"}
    )
    package = await client.post(
        f"/api/v1/products/{product['id']}/packages", json={"name": "Caja 6", "factor": "6"}
    )
    receipt = await _ordered_receipt(
        client,
        product=product,
        package_id=package.json()["packages"][-1]["id"],
        quantity_packages="2",
        unit_cost="7.20",
    )
    assert receipt["cost_proposals"][0]["received_unit_cost"] == "1.200000"
    assert (await _apply(client, receipt)).status_code == 200
    updated = (await client.get(f"/api/v1/products/{product['id']}")).json()
    assert updated["cost"] == "1.200000"
    warehouse_id, location_id = await _location(client)
    sale = await client.post(
        "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
    )
    line = await client.post(
        f"/api/v1/sales/{sale.json()['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": package.json()["packages"][-1]["id"],
            "quantity_packages": "1",
        },
    )
    assert line.json()["lines"][0]["package_price"] == "14.400000"


async def test_partial_and_later_receipts_keep_their_own_cost_history(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _product(client, sku="B10-PARTIAL")
    first = await _ordered_receipt(
        client,
        product=product,
        quantity_packages="60",
        ordered_quantity_packages="100",
        unit_cost="1.20",
    )
    assert (await _apply(client, first)).status_code == 200
    warehouse_id, location_id = await _location(client)
    second_partial = await client.post(
        f"/api/v1/purchase-orders/{first['purchase_order_id']}/receipts",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "lines": [
                {
                    "purchase_order_line_id": first["lines"][0]["purchase_order_line_id"],
                    "quantity_packages": "40",
                }
            ],
        },
    )
    assert second_partial.status_code == 201
    assert second_partial.json()["cost_proposals"] == []
    second = await _ordered_receipt(
        client, product=product, quantity_packages="10", unit_cost="1.30"
    )
    assert second["cost_proposals"][0]["current_catalog_cost"] == "1.200000"
    assert second["cost_proposals"][0]["received_unit_cost"] == "1.300000"
    historical = await client.get(f"/api/v1/goods-receipts/{first['id']}")
    # Once catalog changes again, receipt A still derives its original 1.20
    # from its immutable purchase line rather than the current product cost.
    assert historical.json()["cost_proposals"] == []
    assert (await _apply(client, second)).status_code == 200
    first_after = await client.get(f"/api/v1/goods-receipts/{first['id']}")
    assert first_after.json()["cost_proposals"][0]["received_unit_cost"] == "1.200000"


async def test_apply_received_cost_requires_pricing_permission(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    product = await _product(client, sku="B10-PERMISSIONS")
    receipt = await _ordered_receipt(client, product=product, unit_cost="1.20")
    receiving_read = (
        await db_session.execute(select(Permission).where(Permission.key == "receiving.read"))
    ).scalar_one()
    role = Role(
        name="B10-RECEIVER",
        description="Can read receipts, not pricing.",
        permissions=[receiving_read],
    )
    db_session.add(role)
    await db_session.flush()
    await client.post("/api/v1/auth/logout")
    await login(role_name=role.name)

    denied = await _apply(client, receipt)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "permission_denied"
