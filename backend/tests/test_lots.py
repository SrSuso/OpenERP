"""Lots and FEFO (First Expired, First Out) allocation.

Covers the phase 8 acceptance case from the plan (#12): lot A (2 units,
expires first) + lot B (10 units, expires later); selling 5 must leave A
at 0 and B at 7.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def _create_product(client: AsyncClient, sku: str = "LOT-TEST-1") -> int:
    response = await client.post(
        "/api/v1/products",
        json={
            "sku": sku,
            "name": "Leche 1L",
            "base_unit_name": "BRIK",
            "cost": "0.60",
            "list_price": "0.95",
            "track_lots": True,
            "track_expiration": True,
        },
    )
    assert response.status_code == 201
    result: int = response.json()["id"]
    return result


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_lot(
    client: AsyncClient, product_id: int, lot_number: str, expiration_date: str | None
) -> int:
    response = await client.post(
        "/api/v1/lots",
        json={
            "product_id": product_id,
            "lot_number": lot_number,
            "expiration_date": expiration_date,
        },
    )
    assert response.status_code == 201
    result: int = response.json()["id"]
    return result


async def _stock_lot(
    client: AsyncClient,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    lot_id: int,
    quantity: str,
) -> None:
    response = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": quantity,
            "unit_cost": "0.60",
            "lot_id": lot_id,
        },
    )
    assert response.status_code == 201


async def test_create_lot_and_look_it_up(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)

    lot_id = await _create_lot(client, product_id, "LOTE-A", "2026-08-14")

    response = await client.get(f"/api/v1/lots/{lot_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["lot_number"] == "LOTE-A"
    assert body["expiration_date"] == "2026-08-14"
    assert body["product_id"] == product_id


async def test_create_lot_can_record_its_opening_stock_in_the_same_transaction(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        "/api/v1/lots",
        json={
            "product_id": product_id,
            "lot_number": "LOTE-CON-STOCK",
            "expiration_date": "2030-03-31",
            "opening_stock": {
                "warehouse_id": warehouse_id,
                "location_id": location_id,
                "quantity": "18",
            },
        },
    )

    assert response.status_code == 201
    lot_id = response.json()["id"]
    balances = (await client.get("/api/v1/stock-balance", params={"product_id": product_id})).json()
    assert [(row["lot_id"], row["quantity"]) for row in balances] == [(lot_id, "18.000000")]


async def test_duplicate_lot_number_for_same_product_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    await _create_lot(client, product_id, "LOTE-A", "2026-08-14")

    response = await client.post(
        "/api/v1/lots",
        json={"product_id": product_id, "lot_number": "LOTE-A", "expiration_date": "2026-09-01"},
    )

    assert response.status_code == 409


async def test_lot_balances_are_sorted_fefo(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)
    lot_b = await _create_lot(client, product_id, "LOTE-B", "2026-08-23")
    lot_a = await _create_lot(client, product_id, "LOTE-A", "2026-08-14")
    await _stock_lot(client, product_id, warehouse_id, location_id, lot_b, "35")
    await _stock_lot(client, product_id, warehouse_id, location_id, lot_a, "12")

    response = await client.get(
        f"/api/v1/products/{product_id}/lot-balances",
        params={"warehouse_id": warehouse_id, "location_id": location_id},
    )

    assert response.status_code == 200
    balances = response.json()
    assert [b["lot"]["id"] for b in balances] == [lot_a, lot_b]
    assert balances[0]["quantity"] == "12.000000"
    assert balances[1]["quantity"] == "35.000000"


async def test_fefo_plan_matches_the_spec_example(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Spec example: lot A (2, expires first) + lot B (10); selling 5 must
    take all of A and 3 from B."""
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)
    lot_a = await _create_lot(client, product_id, "LOTE-A", "2026-08-14")
    lot_b = await _create_lot(client, product_id, "LOTE-B", "2026-08-23")
    await _stock_lot(client, product_id, warehouse_id, location_id, lot_a, "2")
    await _stock_lot(client, product_id, warehouse_id, location_id, lot_b, "10")

    response = await client.post(
        f"/api/v1/products/{product_id}/fefo-plan",
        json={"warehouse_id": warehouse_id, "location_id": location_id, "quantity": "5"},
    )

    assert response.status_code == 200
    allocations = response.json()["allocations"]
    assert len(allocations) == 2
    assert allocations[0]["lot_id"] == lot_a
    assert allocations[0]["quantity"] == "2.000000"
    assert allocations[1]["lot_id"] == lot_b
    assert allocations[1]["quantity"] == "3.000000"


async def test_fefo_consume_matches_the_spec_example_end_to_end(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Same example, but actually executed: lot A ends at 0, lot B at 7."""
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)
    lot_a = await _create_lot(client, product_id, "LOTE-A", "2026-08-14")
    lot_b = await _create_lot(client, product_id, "LOTE-B", "2026-08-23")
    await _stock_lot(client, product_id, warehouse_id, location_id, lot_a, "2")
    await _stock_lot(client, product_id, warehouse_id, location_id, lot_b, "10")

    response = await client.post(
        f"/api/v1/products/{product_id}/fefo-consume",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "quantity": "5",
            "movement_type": "ADJUSTMENT",
            "unit_cost": "0.60",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert len(body["movement_ids"]) == 2

    balances = (
        await client.get(
            f"/api/v1/products/{product_id}/lot-balances",
            params={"warehouse_id": warehouse_id, "location_id": location_id},
        )
    ).json()
    by_lot = {b["lot"]["id"]: b["quantity"] for b in balances}
    # Lot A (fully drained) drops out of the positive-balance listing.
    assert lot_a not in by_lot
    assert by_lot[lot_b] == "7.000000"

    overall = (await client.get("/api/v1/stock-balance", params={"product_id": product_id})).json()
    assert sum(float(b["quantity"]) for b in overall) == 7.0


async def test_fefo_consuming_several_lots_automatically(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Spec: "la venta debe poder consumir varios lotes automáticamente" —
    here across three lots in one request."""
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)
    lot_1 = await _create_lot(client, product_id, "L1", "2026-08-10")
    lot_2 = await _create_lot(client, product_id, "L2", "2026-08-15")
    lot_3 = await _create_lot(client, product_id, "L3", "2026-08-20")
    for lot_id in (lot_1, lot_2, lot_3):
        await _stock_lot(client, product_id, warehouse_id, location_id, lot_id, "3")

    response = await client.post(
        f"/api/v1/products/{product_id}/fefo-consume",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "quantity": "8",
            "movement_type": "ADJUSTMENT",
            "unit_cost": "1",
        },
    )

    assert response.status_code == 201
    allocations = response.json()["allocations"]
    assert [(a["lot_id"], a["quantity"]) for a in allocations] == [
        (lot_1, "3.000000"),
        (lot_2, "3.000000"),
        (lot_3, "2.000000"),
    ]


async def test_undated_lots_are_consumed_last(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)
    undated = await _create_lot(client, product_id, "NO-DATE", None)
    dated = await _create_lot(client, product_id, "DATED", "2026-08-14")
    await _stock_lot(client, product_id, warehouse_id, location_id, undated, "5")
    await _stock_lot(client, product_id, warehouse_id, location_id, dated, "5")

    response = await client.post(
        f"/api/v1/products/{product_id}/fefo-plan",
        json={"warehouse_id": warehouse_id, "location_id": location_id, "quantity": "6"},
    )

    allocations = response.json()["allocations"]
    assert allocations[0]["lot_id"] == dated
    assert allocations[1]["lot_id"] == undated


async def test_insufficient_lot_stock_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)
    lot_id = await _create_lot(client, product_id, "LOTE-A", "2026-08-14")
    await _stock_lot(client, product_id, warehouse_id, location_id, lot_id, "3")

    response = await client.post(
        f"/api/v1/products/{product_id}/fefo-plan",
        json={"warehouse_id": warehouse_id, "location_id": location_id, "quantity": "10"},
    )

    assert response.status_code == 422


async def test_non_lot_tracked_movements_are_unaffected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Regression guard for the partial-unique-index design: a product with
    no lot still upserts a single stock_balance row per adjustment, exactly
    as in phase 7."""
    await login(role_name="ADMIN")
    product_response = await client.post(
        "/api/v1/products",
        json={
            "sku": "NO-LOT-1",
            "name": "Producto sin lote",
            "base_unit_name": "UNIDAD",
            "cost": "1.00",
            "list_price": "2.00",
        },
    )
    product_id = product_response.json()["id"]
    warehouse_id, location_id = await _default_location(client)

    for _ in range(3):
        await client.post(
            "/api/v1/stock-movements/adjustments",
            json={
                "product_id": product_id,
                "warehouse_id": warehouse_id,
                "location_id": location_id,
                "movement_type": "ADJUSTMENT",
                "quantity": "1",
                "unit_cost": "1.00",
            },
        )

    balances = (await client.get("/api/v1/stock-balance", params={"product_id": product_id})).json()
    assert len(balances) == 1
    assert balances[0]["quantity"] == "3.000000"
    assert balances[0]["lot_id"] is None


async def test_cashier_can_read_but_not_manage_lots(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/lots")).status_code == 200
    assert (
        await client.post("/api/v1/lots", json={"product_id": 1, "lot_number": "X"})
    ).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/lots")

    assert response.status_code == 401
