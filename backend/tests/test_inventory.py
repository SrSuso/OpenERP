"""The inventory ledger: recording movements, the stock_balance projection,
and that it can always be rebuilt from stock_movements (rule 2 — the spec
explicitly asks for an automated test of this)."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog import service as catalog_service
from app.catalog.schemas import ProductCreate
from app.core.errors import ValidationError
from app.inventory import service as inventory_service
from app.inventory.schemas import TransferCreate


async def _create_product(client: AsyncClient, sku: str = "INV-TEST-1") -> int:
    response = await client.post(
        "/api/v1/products",
        json={
            "sku": sku,
            "name": "Producto de inventario",
            "base_unit_name": "UNIDAD",
            "cost": "1.00",
            "list_price": "2.00",
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


async def test_default_warehouse_and_location_are_seeded(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    warehouse_id, location_id = await _default_location(client)

    assert warehouse_id and location_id


async def test_recording_an_adjustment_updates_the_balance_atomically(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "24",
            "unit_cost": "1.00",
        },
    )
    assert response.status_code == 201
    assert response.json()["product_name"] == "Producto de inventario"

    balances = (await client.get("/api/v1/stock-balance", params={"product_id": product_id})).json()
    assert len(balances) == 1
    assert balances[0]["quantity"] == "24.000000"
    # El nombre viaja con el saldo: es por lo que se identifica el producto
    # en pantalla, y el SKU es sólo la referencia interna.
    assert balances[0]["product_name"] == "Producto de inventario"


async def test_creating_a_product_can_record_its_opening_stock_atomically(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        "/api/v1/products",
        json={
            "sku": "INV-OPENING-STOCK",
            "name": "Producto con stock inicial",
            "base_unit_name": "UNIDAD",
            "cost": "1.25",
            "list_price": "2.50",
            "initial_stock": {
                "warehouse_id": warehouse_id,
                "location_id": location_id,
                "quantity": "24",
            },
        },
    )

    assert response.status_code == 201
    product_id = response.json()["id"]
    balances = (await client.get("/api/v1/stock-balance", params={"product_id": product_id})).json()
    assert [(row["location_id"], row["quantity"]) for row in balances] == [
        (location_id, "24.000000")
    ]
    movements = (
        await client.get("/api/v1/stock-movements", params={"product_id": product_id})
    ).json()
    assert [(row["movement_type"], row["quantity"], row["unit_cost"]) for row in movements] == [
        ("ADJUSTMENT", "24.000000", "1.250000")
    ]


async def test_waste_is_normalised_to_negative(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "1.00",
        },
    )

    # Given as positive, WASTE must still reduce stock.
    response = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "WASTE",
            "quantity": "2",
            "unit_cost": "1.00",
        },
    )
    assert response.status_code == 201
    assert response.json()["quantity"] == "-2.000000"

    balances = (await client.get("/api/v1/stock-balance", params={"product_id": product_id})).json()
    assert balances[0]["quantity"] == "8.000000"


async def test_waste_cannot_make_stock_negative_but_a_signed_adjustment_can(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Preserve the existing policy boundary while protecting consumption.

    WASTE spends real stock and therefore cannot overdraw it. ADJUSTMENT is
    the explicit administrative correction mechanism, whose signed value
    may intentionally produce a negative balance.
    """
    await login(role_name="ADMIN")
    waste_product_id = await _create_product(client, sku="INV-WASTE-NO-NEGATIVE")
    adjustment_product_id = await _create_product(client, sku="INV-SIGNED-ADJUSTMENT")
    warehouse_id, location_id = await _default_location(client)
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": waste_product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "3",
            "unit_cost": "1.00",
        },
    )

    waste = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": waste_product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "WASTE",
            "quantity": "4",
            "unit_cost": "1.00",
        },
    )
    adjustment = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": adjustment_product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "-2",
            "unit_cost": "1.00",
        },
    )

    assert waste.status_code == 422
    assert adjustment.status_code == 201
    waste_balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": waste_product_id})
    ).json()
    adjustment_balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": adjustment_product_id})
    ).json()
    assert waste_balances[0]["quantity"] == "3.000000"
    assert adjustment_balances[0]["quantity"] == "-2.000000"


async def test_zero_quantity_adjustment_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "0",
            "unit_cost": "1.00",
        },
    )

    assert response.status_code == 422


async def test_transfer_moves_stock_between_locations(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "20",
            "unit_cost": "1.00",
        },
    )
    other_warehouse_id = (
        await client.post("/api/v1/warehouses", json={"name": "Almacén secundario"})
    ).json()["id"]
    other_location_id = (
        await client.post(
            f"/api/v1/warehouses/{other_warehouse_id}/locations", json={"name": "Trastienda"}
        )
    ).json()["id"]

    response = await client.post(
        "/api/v1/stock-movements/transfers",
        json={
            "product_id": product_id,
            "from_warehouse_id": warehouse_id,
            "from_location_id": location_id,
            "to_warehouse_id": other_warehouse_id,
            "to_location_id": other_location_id,
            "quantity": "6",
            "unit_cost": "1.00",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["out_movement"]["quantity"] == "-6.000000"
    assert body["in_movement"]["quantity"] == "6.000000"

    balances = {
        b["location_id"]: b["quantity"]
        for b in (
            await client.get("/api/v1/stock-balance", params={"product_id": product_id})
        ).json()
    }
    assert balances[location_id] == "14.000000"
    assert balances[other_location_id] == "6.000000"


async def test_transfer_preserves_the_same_tracked_product_and_lot_on_both_sides(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "INV-TRANSFER-LOT",
                "name": "Transferencia con lote",
                "base_unit_name": "UNIT",
                "cost": "1",
                "list_price": "2",
                "track_lots": True,
            },
        )
    ).json()
    lot = (
        await client.post(
            "/api/v1/lots", json={"product_id": product["id"], "lot_number": "TRANSFER-LOT"}
        )
    ).json()
    warehouse_id, source_location_id = await _default_location(client)
    destination_location_id = (
        await client.post(
            f"/api/v1/warehouses/{warehouse_id}/locations", json={"name": "Destino con lote"}
        )
    ).json()["id"]
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": source_location_id,
            "lot_id": lot["id"],
            "movement_type": "ADJUSTMENT",
            "quantity": "12",
            "unit_cost": "1",
        },
    )

    response = await client.post(
        "/api/v1/stock-movements/transfers",
        json={
            "product_id": product["id"],
            "from_warehouse_id": warehouse_id,
            "from_location_id": source_location_id,
            "to_warehouse_id": warehouse_id,
            "to_location_id": destination_location_id,
            "lot_id": lot["id"],
            "quantity": "10",
            "unit_cost": "1",
        },
    )

    assert response.status_code == 201
    assert response.json()["out_movement"]["lot_id"] == lot["id"]
    assert response.json()["in_movement"]["lot_id"] == lot["id"]
    balances = {
        balance["location_id"]: (balance["lot_id"], balance["quantity"])
        for balance in (
            await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
        ).json()
    }
    assert balances == {
        source_location_id: (lot["id"], "2.000000"),
        destination_location_id: (lot["id"], "10.000000"),
    }


async def test_transfer_to_the_same_location_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        "/api/v1/stock-movements/transfers",
        json={
            "product_id": product_id,
            "from_warehouse_id": warehouse_id,
            "from_location_id": location_id,
            "to_warehouse_id": warehouse_id,
            "to_location_id": location_id,
            "quantity": "1",
            "unit_cost": "1.00",
        },
    )

    assert response.status_code == 422


async def test_movement_rejects_a_location_from_another_warehouse_without_side_effects(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client, sku="INV-WRONG-LOCATION")
    warehouse_id, _location_id = await _default_location(client)
    other_warehouse_id = (
        await client.post("/api/v1/warehouses", json={"name": "Otro almacén A7"})
    ).json()["id"]
    other_location_id = (
        await client.post(
            f"/api/v1/warehouses/{other_warehouse_id}/locations",
            json={"name": "Ubicación ajena A7"},
        )
    ).json()["id"]

    response = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": other_location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "5",
            "unit_cost": "1",
        },
    )

    assert response.status_code == 422
    movements = await client.get("/api/v1/stock-movements", params={"product_id": product_id})
    balances = await client.get("/api/v1/stock-balance", params={"product_id": product_id})
    assert movements.json() == []
    assert balances.json() == []


async def test_movement_rejects_a_lot_from_another_product_without_side_effects(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_a = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "INV-LOT-PRODUCT-A",
                "name": "Producto A",
                "base_unit_name": "UNIT",
                "cost": "1",
                "list_price": "2",
                "track_lots": True,
            },
        )
    ).json()
    product_b = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "INV-LOT-PRODUCT-B",
                "name": "Producto B",
                "base_unit_name": "UNIT",
                "cost": "1",
                "list_price": "2",
                "track_lots": True,
            },
        )
    ).json()
    lot_b = (
        await client.post(
            "/api/v1/lots", json={"product_id": product_b["id"], "lot_number": "LOT-B"}
        )
    ).json()
    warehouse_id, location_id = await _default_location(client)

    response = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_a["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "5",
            "unit_cost": "1",
            "lot_id": lot_b["id"],
        },
    )

    assert response.status_code == 422
    assert (
        await client.get("/api/v1/stock-movements", params={"product_id": product_a["id"]})
    ).json() == []
    assert (
        await client.get("/api/v1/stock-balance", params={"product_id": product_a["id"]})
    ).json() == []


async def test_lot_policy_is_enforced_for_direct_movements(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    tracked = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "INV-LOT-REQUIRED",
                "name": "Con lote",
                "base_unit_name": "UNIT",
                "cost": "1",
                "list_price": "2",
                "track_lots": True,
            },
        )
    ).json()
    untracked_id = await _create_product(client, sku="INV-LOT-FORBIDDEN")
    forbidden_lot = (
        await client.post(
            "/api/v1/lots", json={"product_id": untracked_id, "lot_number": "LOT-NOT-TRACKED"}
        )
    ).json()
    warehouse_id, location_id = await _default_location(client)
    common = {
        "warehouse_id": warehouse_id,
        "location_id": location_id,
        "movement_type": "ADJUSTMENT",
        "quantity": "1",
        "unit_cost": "1",
    }

    missing = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={**common, "product_id": tracked["id"]},
    )
    forbidden = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={**common, "product_id": untracked_id, "lot_id": forbidden_lot["id"]},
    )

    assert missing.status_code == 422
    assert forbidden.status_code == 422
    assert (
        await client.get("/api/v1/stock-movements", params={"product_id": tracked["id"]})
    ).json() == []
    assert (
        await client.get("/api/v1/stock-movements", params={"product_id": untracked_id})
    ).json() == []


async def test_invalid_transfer_context_writes_neither_side(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client, sku="INV-TRANSFER-CONTEXT")
    source_warehouse_id, source_location_id = await _default_location(client)
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": source_warehouse_id,
            "location_id": source_location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "1",
        },
    )
    destination_warehouse_id = (
        await client.post("/api/v1/warehouses", json={"name": "Destino A7"})
    ).json()["id"]
    third_warehouse_id = (
        await client.post("/api/v1/warehouses", json={"name": "Tercero A7"})
    ).json()["id"]
    wrong_location_id = (
        await client.post(
            f"/api/v1/warehouses/{third_warehouse_id}/locations", json={"name": "No destino"}
        )
    ).json()["id"]

    response = await client.post(
        "/api/v1/stock-movements/transfers",
        json={
            "product_id": product_id,
            "from_warehouse_id": source_warehouse_id,
            "from_location_id": source_location_id,
            "to_warehouse_id": destination_warehouse_id,
            "to_location_id": wrong_location_id,
            "quantity": "4",
            "unit_cost": "1",
        },
    )

    assert response.status_code == 422
    movements = (
        await client.get("/api/v1/stock-movements", params={"product_id": product_id})
    ).json()
    assert [movement["movement_type"] for movement in movements] == ["ADJUSTMENT"]
    balances = (await client.get("/api/v1/stock-balance", params={"product_id": product_id})).json()
    assert len(balances) == 1
    assert balances[0]["location_id"] == source_location_id
    assert balances[0]["quantity"] == "10.000000"


async def test_transfer_rejects_insufficient_source_stock_without_partial_movement(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client, sku="INV-TRANSFER-INSUFFICIENT")
    warehouse_id, source_location_id = await _default_location(client)
    destination_location_id = (
        await client.post(
            f"/api/v1/warehouses/{warehouse_id}/locations", json={"name": "Destino insuficiente"}
        )
    ).json()["id"]
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": source_location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "5",
            "unit_cost": "1",
        },
    )

    response = await client.post(
        "/api/v1/stock-movements/transfers",
        json={
            "product_id": product_id,
            "from_warehouse_id": warehouse_id,
            "from_location_id": source_location_id,
            "to_warehouse_id": warehouse_id,
            "to_location_id": destination_location_id,
            "quantity": "6",
            "unit_cost": "1",
        },
    )

    assert response.status_code == 422
    balances = (await client.get("/api/v1/stock-balance", params={"product_id": product_id})).json()
    assert [(balance["location_id"], balance["quantity"]) for balance in balances] == [
        (source_location_id, "5.000000")
    ]


async def test_concurrent_transfers_cannot_spend_the_same_source_balance(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    async with committing_sessionmaker() as setup_session:
        product = await catalog_service.create_product(
            setup_session,
            ProductCreate(
                sku="INV-CONCURRENT-TRANSFER-A7",
                name="Concurrent transfer product",
                base_unit_name="UNIT",
                cost=Decimal("1"),
                list_price=Decimal("1"),
            ),
        )
        warehouses = await inventory_service.list_warehouses(setup_session)
        warehouse = next(item for item in warehouses if item.name == "Tienda principal")
        locations = await inventory_service.list_locations(setup_session, warehouse.id)
        source = next(item for item in locations if item.name == "Almacén")
        destination_a = await inventory_service.create_location(
            setup_session, warehouse.id, "Concurrent destination A7 A"
        )
        destination_b = await inventory_service.create_location(
            setup_session, warehouse.id, "Concurrent destination A7 B"
        )
        await inventory_service.record_movement(
            setup_session,
            product_id=product.id,
            warehouse_id=warehouse.id,
            location_id=source.id,
            quantity=Decimal("10"),
            movement_type="ADJUSTMENT",
            unit_cost=Decimal("1"),
        )
        await setup_session.commit()
        ids = product.id, warehouse.id, source.id, destination_a.id, destination_b.id

    product_id, warehouse_id, source_id, destination_a_id, destination_b_id = ids

    async def transfer(destination_id: int) -> str:
        async with committing_sessionmaker() as session:
            try:
                await inventory_service.record_transfer(
                    session,
                    TransferCreate(
                        product_id=product_id,
                        from_warehouse_id=warehouse_id,
                        from_location_id=source_id,
                        to_warehouse_id=warehouse_id,
                        to_location_id=destination_id,
                        quantity=Decimal("7"),
                        unit_cost=Decimal("1"),
                    ),
                )
                await session.commit()
                return "ok"
            except ValidationError:
                await session.rollback()
                return "insufficient"

    results = await asyncio.gather(transfer(destination_a_id), transfer(destination_b_id))

    assert sorted(results) == ["insufficient", "ok"]
    async with committing_sessionmaker() as session:
        balances = await inventory_service.list_balances(session, product_id=product_id)
    quantities = {balance.location_id: balance.quantity for balance in balances}
    assert quantities[source_id] == Decimal("3")
    assert quantities.get(destination_a_id, Decimal(0)) + quantities.get(
        destination_b_id, Decimal(0)
    ) == Decimal("7")


async def test_stock_movements_list_is_read_only(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """No PATCH/DELETE on a movement is exposed anywhere — append-only
    (rule 1) is enforced by the absence of such a route, not just policy."""
    await login(role_name="ADMIN")

    exported = {name for name in dir(inventory_service) if not name.startswith("_")}
    assert exported.isdisjoint({"update_movement", "delete_movement"})


async def test_rebuild_stock_balance_reproduces_identical_balances(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """The spec's own required test: delete stock_balance, rebuild it from
    stock_movements, and the result must be identical."""
    await login(role_name="ADMIN")
    product_a = await _create_product(client, sku="INV-REBUILD-A")
    product_b = await _create_product(client, sku="INV-REBUILD-B")
    warehouse_id, location_id = await _default_location(client)

    for product_id, quantity in (
        (product_a, "24"),
        (product_a, "-8"),
        (product_a, "5"),
        (product_b, "12"),
        (product_b, "-3"),
    ):
        response = await client.post(
            "/api/v1/stock-movements/adjustments",
            json={
                "product_id": product_id,
                "warehouse_id": warehouse_id,
                "location_id": location_id,
                "movement_type": "ADJUSTMENT",
                "quantity": quantity,
                "unit_cost": "1.00",
            },
        )
        assert response.status_code == 201

    before = sorted(
        (await client.get("/api/v1/stock-balance")).json(),
        key=lambda b: (b["product_id"], b["warehouse_id"], b["location_id"]),
    )
    assert any(b["product_id"] == product_a and b["quantity"] == "21.000000" for b in before)
    assert any(b["product_id"] == product_b and b["quantity"] == "9.000000" for b in before)

    rebuild_response = await client.post("/api/v1/stock-balance/rebuild")
    assert rebuild_response.status_code == 200
    assert rebuild_response.json()["rows"] >= 2

    after = sorted(
        (await client.get("/api/v1/stock-balance")).json(),
        key=lambda b: (b["product_id"], b["warehouse_id"], b["location_id"]),
    )
    assert after == before


async def test_concurrent_adjustments_do_not_lose_updates(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Two concurrent movements against the same product/warehouse/location
    must both apply — the row lock in _locked_balance is what phase 11's
    checkout concurrency will depend on."""
    async with committing_sessionmaker() as setup_session:
        product = await catalog_service.create_product(
            setup_session,
            ProductCreate(
                sku="INV-CONCURRENCY-1",
                name="Concurrency test product",
                base_unit_name="UNIDAD",
                cost=Decimal("1"),
                list_price=Decimal("1"),
            ),
        )
        await setup_session.commit()
        product_id = product.id

        warehouses = await inventory_service.list_warehouses(setup_session)
        warehouse = next(w for w in warehouses if w.name == "Tienda principal")
        locations = await inventory_service.list_locations(setup_session, warehouse.id)
        location = next(loc for loc in locations if loc.name == "Almacén")
        warehouse_id, location_id = warehouse.id, location.id

    async def bump() -> None:
        async with committing_sessionmaker() as session:
            await inventory_service.record_movement(
                session,
                product_id=product_id,
                warehouse_id=warehouse_id,
                location_id=location_id,
                quantity=Decimal(1),
                movement_type="ADJUSTMENT",
                unit_cost=Decimal(0),
            )
            await session.commit()

    await asyncio.gather(*(bump() for _ in range(10)))

    async with committing_sessionmaker() as session:
        balances = await inventory_service.list_balances(
            session, product_id=product_id, warehouse_id=warehouse_id
        )
    assert balances[0].quantity == Decimal(10)


async def test_cashier_can_read_but_not_manage_inventory(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/stock-balance")).status_code == 200
    assert (
        await client.post(
            "/api/v1/stock-movements/adjustments",
            json={
                "product_id": 1,
                "warehouse_id": 1,
                "location_id": 1,
                "movement_type": "ADJUSTMENT",
                "quantity": "1",
                "unit_cost": "1",
            },
        )
    ).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/stock-balance")

    assert response.status_code == 401


async def test_stock_totals_add_up_a_products_locations(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un total por producto, que es lo que enseña la columna de stock de la
    lista de productos — no una fila por ubicación."""
    await login(role_name="ADMIN")
    product_id = await _create_product(client, sku="INV-TOTALS")
    warehouse_id, location_id = await _default_location(client)
    other_location = (
        await client.post(
            f"/api/v1/warehouses/{warehouse_id}/locations", json={"name": "Pasillo 2"}
        )
    ).json()["id"]
    for location in (location_id, other_location):
        await client.post(
            "/api/v1/stock-movements/adjustments",
            json={
                "product_id": product_id,
                "warehouse_id": warehouse_id,
                "location_id": location,
                "movement_type": "ADJUSTMENT",
                "quantity": "5",
                "unit_cost": "1",
            },
        )

    totals = (await client.get("/api/v1/stock-balance/totals")).json()

    mine = [t for t in totals if t["product_id"] == product_id]
    assert mine == [{"product_id": product_id, "quantity": "10.000000"}]
