"""Checkout (phase 13): the only place a sale ever moves stock or reaches
``COMPLETED`` — atomically with recording the payment(s) (rule 5)."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog import service as catalog_service
from app.catalog.schemas import ProductCreate
from app.core.errors import ConflictError
from app.inventory import service as inventory_service
from app.sales import service as sales_service
from app.sales.schemas import CheckoutRequest, PaymentCreate, SaleCreate, SaleLineCreate


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_product(
    client: AsyncClient, sku: str = "CHECKOUT-TEST-1", **overrides: Any
) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": "Producto de cobro",
        "base_unit_name": "UNIDAD",
        "cost": "1.00",
        "list_price": "10.00",
        "tax_rate": "21",
    }
    payload.update(overrides)
    response = await client.post("/api/v1/products", json=payload)
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def _stock(
    client: AsyncClient,
    *,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    quantity: str,
    lot_id: int | None = None,
) -> None:
    payload: dict[str, Any] = {
        "product_id": product_id,
        "warehouse_id": warehouse_id,
        "location_id": location_id,
        "movement_type": "ADJUSTMENT",
        "quantity": quantity,
        "unit_cost": "1.00",
    }
    if lot_id is not None:
        payload["lot_id"] = lot_id
    response = await client.post("/api/v1/stock-movements/adjustments", json=payload)
    assert response.status_code == 201


async def _ready_sale(
    client: AsyncClient, *, product: dict[str, Any], quantity: str = "1"
) -> dict[str, Any]:
    """Open a DRAFT sale with one line for ``product``, ready to check out."""
    warehouse_id, location_id = await _default_location(client)
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    added = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": quantity},
    )
    assert added.status_code == 201
    result: dict[str, Any] = added.json()
    return result


async def test_checkout_with_exact_cash_completes_the_sale_and_moves_stock(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="CHECKOUT-CASH")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    await login(role_name="CASHIER")
    sale = await _ready_sale(client, product=product, quantity="3")
    # 3 * 10.00 = 30, + 21% tax = 36.3
    assert sale["total"] == "36.300000"

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "36.30"}]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "COMPLETED"
    assert body["completed_at"] is not None
    # Zero can serialise as "0" rather than "0.000000" (same quirk as an
    # empty sale's `total` in phase 11) — compare the value, not the string.
    assert Decimal(body["change_due"]) == Decimal(0)
    assert len(body["payments"]) == 1
    assert body["payments"][0]["method"] == "CASH"

    balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    assert balances[0]["quantity"] == "7.000000"

    movements = (
        await client.get("/api/v1/stock-movements", params={"product_id": product["id"]})
    ).json()
    sale_movement = next(m for m in movements if m["reference_type"] == "sale")
    assert sale_movement["movement_type"] == "SALE"
    assert sale_movement["reference_id"] == sale["id"]
    assert sale_movement["quantity"] == "-3.000000"


async def test_split_payment_across_cash_and_card(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="CHECKOUT-SPLIT", list_price="20.00", tax_rate="0")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="5",
    )
    await login(role_name="CASHIER")
    sale = await _ready_sale(client, product=product, quantity="1")
    assert sale["total"] == "20.000000"

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={
            "payments": [
                {"method": "CARD", "amount": "12.00"},
                {"method": "CASH", "amount": "8.00"},
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "COMPLETED"
    assert Decimal(body["change_due"]) == Decimal(0)
    assert {p["method"] for p in body["payments"]} == {"CARD", "CASH"}


async def test_cash_overpayment_returns_change(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="CHECKOUT-CHANGE", list_price="9.00", tax_rate="0")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="5",
    )
    await login(role_name="CASHIER")
    sale = await _ready_sale(client, product=product, quantity="1")

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "20.00"}]},
    )

    assert response.status_code == 200
    assert response.json()["change_due"] == "11.000000"


async def test_card_overpayment_without_cash_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(
        client, sku="CHECKOUT-CARD-OVER", list_price="9.00", tax_rate="0"
    )
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="5",
    )
    await login(role_name="CASHIER")
    sale = await _ready_sale(client, product=product, quantity="1")

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CARD", "amount": "20.00"}]},
    )

    assert response.status_code == 422
    refreshed = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert refreshed["status"] == "DRAFT"


async def test_underpayment_is_rejected_and_sale_stays_draft(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="CHECKOUT-UNDER")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="5",
    )
    await login(role_name="CASHIER")
    sale = await _ready_sale(client, product=product, quantity="1")

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "1.00"}]},
    )

    assert response.status_code == 422
    refreshed = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert refreshed["status"] == "DRAFT"
    assert refreshed["payments"] == []


async def test_insufficient_stock_is_rejected_atomically(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="CHECKOUT-NOSTOCK")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="2",
    )
    await login(role_name="CASHIER")
    sale = await _ready_sale(client, product=product, quantity="5")

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "1000.00"}]},
    )

    assert response.status_code == 409
    refreshed = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert refreshed["status"] == "DRAFT"
    assert refreshed["payments"] == []
    balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    assert balances[0]["quantity"] == "2.000000"


async def test_cannot_check_out_a_sale_with_no_lines(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")
    warehouse_id, location_id = await _default_location(client)
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "1.00"}]},
    )

    assert response.status_code == 422


async def test_cannot_check_out_twice_and_completed_sale_rejects_further_mutation(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="CHECKOUT-TWICE")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    await login(role_name="CASHIER")
    sale = await _ready_sale(client, product=product, quantity="1")
    first = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "100.00"}]},
    )
    assert first.status_code == 200

    second = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "100.00"}]},
    )
    assert second.status_code == 409

    cancel = await client.post(f"/api/v1/sales/{sale['id']}/cancel")
    assert cancel.status_code == 409

    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    add_line = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )
    assert add_line.status_code == 409


async def test_checking_out_a_cancelled_sale_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="CHECKOUT-CANCELLED")
    await login(role_name="CASHIER")
    sale = await _ready_sale(client, product=product, quantity="1")
    await client.post(f"/api/v1/sales/{sale['id']}/cancel")

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "100.00"}]},
    )

    assert response.status_code == 409


async def test_checkout_consumes_lots_fefo(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Same acceptance shape as the phase 8 FEFO case, driven through
    checkout: lot A (2 units, expires first) + lot B (10 units); selling 5
    must leave A at 0 and B at 7."""
    await login(role_name="ADMIN")
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "CHECKOUT-FEFO",
                "name": "Producto con lote",
                "base_unit_name": "UNIDAD",
                "cost": "1.00",
                "list_price": "1.00",
                "tax_rate": "0",
                "track_lots": True,
                "track_expiration": True,
            },
        )
    ).json()
    warehouse_id, location_id = await _default_location(client)
    lot_a = (
        await client.post(
            "/api/v1/lots",
            json={
                "product_id": product["id"],
                "lot_number": "LOTE-A",
                "expiration_date": "2026-09-01",
            },
        )
    ).json()["id"]
    lot_b = (
        await client.post(
            "/api/v1/lots",
            json={
                "product_id": product["id"],
                "lot_number": "LOTE-B",
                "expiration_date": "2026-12-01",
            },
        )
    ).json()["id"]
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="2",
        lot_id=lot_a,
    )
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
        lot_id=lot_b,
    )
    await login(role_name="CASHIER")
    sale = await _ready_sale(client, product=product, quantity="5")

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": "100.00"}]},
    )

    assert response.status_code == 200
    balances = {
        b["lot_id"]: b["quantity"]
        for b in (
            await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
        ).json()
    }
    assert balances[lot_a] == "0.000000"
    assert balances[lot_b] == "7.000000"


async def test_unauthenticated_checkout_is_401(client: AsyncClient) -> None:
    response = await client.post("/api/v1/sales/1/checkout", json={"payments": []})

    assert response.status_code == 401


async def test_concurrent_checkouts_never_oversell(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Two sales, each wanting the entire stock of 5 units. Only one
    checkout may succeed; the row lock in
    ``inventory.service.lock_and_get_available_quantity`` is what makes
    this safe under real concurrency, not just single-threaded ordering."""
    async with committing_sessionmaker() as setup_session:
        product = await catalog_service.create_product(
            setup_session,
            ProductCreate(
                sku="CHECKOUT-CONCURRENCY-1",
                name="Concurrency checkout product",
                base_unit_name="UNIDAD",
                cost=Decimal("1"),
                list_price=Decimal("1"),
                tax_rate=Decimal("0"),
            ),
        )
        product_id = product.id
        base_package_id = product.packages[0].id

        warehouses = await inventory_service.list_warehouses(setup_session)
        warehouse = next(w for w in warehouses if w.name == "Tienda principal")
        locations = await inventory_service.list_locations(setup_session, warehouse.id)
        location = next(loc for loc in locations if loc.name == "Almacén")
        warehouse_id, location_id = warehouse.id, location.id

        await inventory_service.record_movement(
            setup_session,
            product_id=product_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            quantity=Decimal(5),
            movement_type="ADJUSTMENT",
            unit_cost=Decimal(0),
        )

        sale_ids: list[int] = []
        for _ in range(2):
            sale = await sales_service.create_sale(
                setup_session,
                SaleCreate(warehouse_id=warehouse_id, location_id=location_id),
            )
            await sales_service.add_line(
                setup_session,
                sale.id,
                SaleLineCreate(
                    product_id=product_id, package_id=base_package_id, quantity_packages=Decimal(5)
                ),
            )
            sale_ids.append(sale.id)
        await setup_session.commit()

    async def attempt(sale_id: int) -> str:
        try:
            async with committing_sessionmaker() as session:
                await sales_service.checkout(
                    session,
                    sale_id,
                    CheckoutRequest(payments=[PaymentCreate(method="CASH", amount=Decimal(1000))]),
                )
                await session.commit()
            return "ok"
        except ConflictError:
            return "insufficient_stock"

    results = await asyncio.gather(*(attempt(sale_id) for sale_id in sale_ids))

    assert sorted(results) == ["insufficient_stock", "ok"]

    async with committing_sessionmaker() as session:
        balances = await inventory_service.list_balances(
            session, product_id=product_id, warehouse_id=warehouse_id
        )
    assert balances[0].quantity == Decimal(0)
