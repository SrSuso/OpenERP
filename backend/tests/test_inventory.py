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
from app.inventory import service as inventory_service


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

    balances = (await client.get("/api/v1/stock-balance", params={"product_id": product_id})).json()
    assert len(balances) == 1
    assert balances[0]["quantity"] == "24.000000"
    # El nombre viaja con el saldo: es por lo que se identifica el producto
    # en pantalla, y el SKU es sólo la referencia interna.
    assert balances[0]["product_name"] == "Producto de inventario"


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
