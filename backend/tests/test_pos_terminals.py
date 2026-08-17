"""A9: a physical POS terminal owns its open carts independently."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Any

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog import service as catalog_service
from app.catalog.schemas import ProductCreate
from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.inventory import service as inventory_service
from app.main import create_app
from app.pos import service as terminal_service
from app.pos.schemas import PosTerminalCreate
from app.sales import service as sales_service
from app.sales.schemas import SaleCreate, SaleLineCreate
from app.users.models import User
from tests.conftest import DEFAULT_PASSWORD


@asynccontextmanager
async def _http_client(settings: Settings, db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings

    async def _override_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_session] = _override_session
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        yield client
    app.dependency_overrides.clear()


async def _login(client: AsyncClient, user: User) -> None:
    response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 200


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(item for item in warehouses if item["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(item for item in locations if item["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_terminal(client: AsyncClient, name: str, warehouse_id: int) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/pos-terminals", json={"name": name, "warehouse_id": warehouse_id}
    )
    assert response.status_code == 201
    result: dict[str, Any] = response.json()
    return result


def _terminal_headers(terminal_id: int, **extra: str) -> dict[str, str]:
    return {"X-POS-Terminal-ID": str(terminal_id), **extra}


async def _open_sale(
    client: AsyncClient, terminal_id: int, warehouse_id: int, location_id: int
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/sales",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "terminal_id": terminal_id,
        },
    )
    assert response.status_code == 201
    result: dict[str, Any] = response.json()
    return result


async def _create_product(
    client: AsyncClient, *, sku: str, tracks_stock: bool = True
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/products",
        json={
            "sku": sku,
            "name": sku,
            "base_unit_name": "UNIDAD",
            "cost": "1",
            "list_price": "1",
            "tax_rate": "0",
            "tracks_stock": tracks_stock,
        },
    )
    assert response.status_code == 201
    result: dict[str, Any] = response.json()
    return result


async def test_two_clients_only_recover_drafts_from_their_selected_terminal(
    settings: Settings,
    db_session: AsyncSession,
    make_user: Callable[..., Awaitable[User]],
) -> None:
    """T1/T2/T4/T5/T15: browser sessions and users do not define ownership."""
    same_user = await make_user(email="a9-same-user@example.com", role_name="ADMIN")
    other_user = await make_user(email="a9-other-user@example.com", role_name="ADMIN")

    async with (
        _http_client(settings, db_session) as client_a,
        _http_client(settings, db_session) as client_b,
    ):
        await _login(client_a, same_user)
        await _login(client_b, same_user)
        warehouse_id, location_id = await _default_location(client_a)
        terminal_a = await _create_terminal(client_a, "A9 Caja 1", warehouse_id)
        terminal_b = await _create_terminal(client_a, "A9 Caja 2", warehouse_id)

        sale_a = await _open_sale(client_a, terminal_a["id"], warehouse_id, location_id)
        sale_b = await _open_sale(client_b, terminal_b["id"], warehouse_id, location_id)
        assert sale_a["id"] != sale_b["id"]
        assert sale_a["cashier_user_id"] == sale_b["cashier_user_id"] == same_user.id

        drafts_a = (
            await client_a.get(
                f"/api/v1/sales?status=DRAFT&terminal_id={terminal_a['id']}",
                headers=_terminal_headers(terminal_a["id"]),
            )
        ).json()
        drafts_b = (
            await client_b.get(
                f"/api/v1/sales?status=DRAFT&terminal_id={terminal_b['id']}",
                headers=_terminal_headers(terminal_b["id"]),
            )
        ).json()
        assert [sale["id"] for sale in drafts_a] == [sale_a["id"]]
        assert [sale["id"] for sale in drafts_b] == [sale_b["id"]]

    # Browser closed/reopened: a fresh cookie jar logs in and recovers by the
    # persistent terminal id, even when a different cashier uses that till.
    async with _http_client(settings, db_session) as reopened:
        await _login(reopened, other_user)
        recovered = (
            await reopened.get(
                f"/api/v1/sales?status=DRAFT&terminal_id={terminal_a['id']}",
                headers=_terminal_headers(terminal_a["id"]),
            )
        ).json()
        assert [sale["id"] for sale in recovered] == [sale_a["id"]]
        assert recovered[0]["cashier_user_id"] == same_user.id


async def test_wrong_terminal_cannot_mutate_or_checkout_a_sale(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """T3/T10/T11/T12: direct IDs cannot cross the terminal boundary."""
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    terminal_a = await _create_terminal(client, "A9 Direct A", warehouse_id)
    terminal_b = await _create_terminal(client, "A9 Direct B", warehouse_id)
    product = await _create_product(client, sku="A9-DIRECT-STOCK")
    package_id = product["packages"][0]["id"]
    stock = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "1",
        },
    )
    assert stock.status_code == 201
    sale = await _open_sale(client, terminal_a["id"], warehouse_id, location_id)

    missing_identity = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": package_id,
            "quantity_packages": "6",
        },
    )
    assert missing_identity.status_code == 409

    wrong_add = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        headers=_terminal_headers(terminal_b["id"]),
        json={
            "product_id": product["id"],
            "package_id": package_id,
            "quantity_packages": "6",
        },
    )
    assert wrong_add.status_code == 409

    added = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        headers=_terminal_headers(terminal_a["id"]),
        json={
            "product_id": product["id"],
            "package_id": package_id,
            "quantity_packages": "6",
        },
    )
    assert added.status_code == 201
    line_id = added.json()["lines"][0]["id"]
    wrong_delete = await client.delete(
        f"/api/v1/sales/{sale['id']}/lines/{line_id}",
        headers=_terminal_headers(terminal_b["id"]),
    )
    assert wrong_delete.status_code == 409
    wrong_cancel = await client.post(
        f"/api/v1/sales/{sale['id']}/cancel",
        headers=_terminal_headers(terminal_b["id"]),
    )
    assert wrong_cancel.status_code == 409

    wrong_checkout = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        headers=_terminal_headers(terminal_b["id"], **{"Idempotency-Key": "a9-wrong"}),
        json={"payments": [{"method": "CASH", "amount": "6"}]},
    )
    assert wrong_checkout.status_code == 409

    completed = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        headers=_terminal_headers(terminal_a["id"], **{"Idempotency-Key": "a9-right"}),
        json={"payments": [{"method": "CASH", "amount": "6"}]},
    )
    assert completed.status_code == 200
    assert completed.json()["terminal_id"] == terminal_a["id"]
    balances = (
        await client.get(
            f"/api/v1/stock-balance?product_id={product['id']}&warehouse_id={warehouse_id}"
        )
    ).json()
    assert Decimal(balances[0]["quantity"]) == Decimal("4")


async def test_terminal_warehouse_is_authoritative(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """T6: neither creation nor a filtered recovery may mix warehouses."""
    await login(role_name="ADMIN")
    warehouse_a, location_a = await _default_location(client)
    warehouse_b = (await client.post("/api/v1/warehouses", json={"name": "A9 Warehouse B"})).json()
    location_b = (
        await client.post(
            f"/api/v1/warehouses/{warehouse_b['id']}/locations", json={"name": "A9 Location B"}
        )
    ).json()
    terminal_b = await _create_terminal(client, "A9 Caja B", warehouse_b["id"])

    wrong_create = await client.post(
        "/api/v1/sales",
        json={
            "warehouse_id": warehouse_a,
            "location_id": location_a,
            "terminal_id": terminal_b["id"],
        },
    )
    assert wrong_create.status_code == 422
    own_sale = await _open_sale(client, terminal_b["id"], warehouse_b["id"], location_b["id"])
    wrong_recovery = await client.get(
        f"/api/v1/sales?status=DRAFT&warehouse_id={warehouse_a}&terminal_id={terminal_b['id']}",
        headers=_terminal_headers(terminal_b["id"]),
    )
    assert wrong_recovery.status_code == 422
    assert own_sale["warehouse_id"] == warehouse_b["id"]


async def test_inactive_terminal_blocks_work_but_preserves_drafts_and_history(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """T7/T8: deactivation is a gate, never a cascade or historical rewrite."""
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    terminal = await _create_terminal(client, "A9 Inactive", warehouse_id)
    draft = await _open_sale(client, terminal["id"], warehouse_id, location_id)

    deactivated = await client.patch(
        f"/api/v1/pos-terminals/{terminal['id']}", json={"is_active": False}
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    start = await client.post(
        "/api/v1/sales",
        json={
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "terminal_id": terminal["id"],
        },
    )
    assert start.status_code == 409
    recovery = await client.get(
        f"/api/v1/sales?status=DRAFT&terminal_id={terminal['id']}",
        headers=_terminal_headers(terminal["id"]),
    )
    assert recovery.status_code == 409
    mutation = await client.post(
        f"/api/v1/sales/{draft['id']}/cancel", headers=_terminal_headers(terminal["id"])
    )
    assert mutation.status_code == 409

    # Generic administration can still find the stranded draft; no transfer
    # operation is silently invented in A9.
    visible = (await client.get(f"/api/v1/sales/{draft['id']}")).json()
    assert visible["status"] == "DRAFT"
    assert visible["terminal_id"] == terminal["id"]


async def test_terminal_administration_renames_and_deactivates_but_never_moves_or_deletes(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    terminal = await _create_terminal(client, "A9 Admin", warehouse_id)
    sale = await _open_sale(client, terminal["id"], warehouse_id, location_id)

    renamed = await client.patch(
        f"/api/v1/pos-terminals/{terminal['id']}", json={"name": "A9 Admin Renamed"}
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "A9 Admin Renamed"
    assert renamed.json()["show_product_search"] is True
    search_disabled = await client.patch(
        f"/api/v1/pos-terminals/{terminal['id']}", json={"show_product_search": False}
    )
    assert search_disabled.status_code == 200
    assert search_disabled.json()["show_product_search"] is False
    # The stable historical datum is the FK; labels intentionally show the
    # current administrative name instead of keeping a redundant snapshot.
    historical = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert historical["terminal_id"] == terminal["id"]
    assert historical["terminal_name"] == "A9 Admin Renamed"
    move = await client.patch(
        f"/api/v1/pos-terminals/{terminal['id']}", json={"warehouse_id": warehouse_id}
    )
    assert move.status_code == 422
    assert (await client.delete(f"/api/v1/pos-terminals/{terminal['id']}")).status_code == 405

    listed = (await client.get("/api/v1/pos-terminals?active_only=false")).json()
    assert any(item["id"] == terminal["id"] for item in listed)

    await login(role_name="CASHIER")
    forbidden = await client.post(
        "/api/v1/pos-terminals", json={"name": "Not allowed", "warehouse_id": warehouse_id}
    )
    assert forbidden.status_code == 403


async def test_concurrent_tabs_merge_delta_commands_without_lost_updates(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """T9: Sale FOR UPDATE makes two stale tabs' add commands cumulative."""
    async with committing_sessionmaker() as session:
        warehouse = await inventory_service.create_warehouse(session, "A9 concurrent warehouse")
        location = await inventory_service.create_location(session, warehouse.id, "A9 till")
        terminal = await terminal_service.create_terminal(
            session,
            PosTerminalCreate(name="A9 concurrent terminal", warehouse_id=warehouse.id),
        )
        product = await catalog_service.create_product(
            session,
            ProductCreate(
                sku="A9-CONCURRENT-TABS",
                name="A9 concurrent tabs",
                base_unit_name="UNIDAD",
                cost=Decimal("1"),
                list_price=Decimal("1"),
                tracks_stock=False,
            ),
        )
        sale = await sales_service.create_sale(
            session,
            SaleCreate(
                warehouse_id=warehouse.id,
                location_id=location.id,
                terminal_id=terminal.id,
            ),
        )
        sale_id = sale.id
        terminal_id = terminal.id
        package_id = product.packages[0].id
        product_id = product.id
        await session.commit()

    async def add_from_tab() -> Decimal:
        async with committing_sessionmaker() as session:
            updated = await sales_service.add_line(
                session,
                sale_id,
                SaleLineCreate(
                    product_id=product_id,
                    package_id=package_id,
                    quantity_packages=Decimal("1"),
                ),
                terminal_id=terminal_id,
            )
            quantity = updated.lines[0].quantity_packages
            await session.commit()
            return quantity

    await asyncio.wait_for(asyncio.gather(add_from_tab(), add_from_tab()), timeout=10)
    async with committing_sessionmaker() as session:
        persisted = await sales_service.get_sale(session, sale_id)
    assert len(persisted.lines) == 1
    assert persisted.lines[0].quantity_packages == Decimal("2")


async def test_z_report_still_aggregates_sales_from_two_terminals_by_warehouse(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """T14: A6's accounting boundary remains warehouse-wide."""
    await login(role_name="ADMIN")
    warehouse = (await client.post("/api/v1/warehouses", json={"name": "A9 Z Warehouse"})).json()
    location = (
        await client.post(
            f"/api/v1/warehouses/{warehouse['id']}/locations", json={"name": "A9 Z Location"}
        )
    ).json()
    terminals = [
        await _create_terminal(client, f"A9 Z Caja {number}", warehouse["id"]) for number in (1, 2)
    ]
    product = await _create_product(client, sku="A9-Z-PRODUCT", tracks_stock=False)
    package_id = product["packages"][0]["id"]

    for number, terminal in enumerate(terminals, start=1):
        sale = await _open_sale(client, terminal["id"], warehouse["id"], location["id"])
        added = await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            headers=_terminal_headers(terminal["id"]),
            json={
                "product_id": product["id"],
                "package_id": package_id,
                "quantity_packages": str(number),
            },
        )
        assert added.status_code == 201
        completed = await client.post(
            f"/api/v1/sales/{sale['id']}/checkout",
            headers=_terminal_headers(terminal["id"], **{"Idempotency-Key": f"a9-z-sale-{number}"}),
            json={"payments": [{"method": "CASH", "amount": str(number)}]},
        )
        assert completed.status_code == 200

    report = await client.post(
        f"/api/v1/z-reports?warehouse_id={warehouse['id']}",
        headers={"Idempotency-Key": "a9-z-two-terminals"},
    )
    assert report.status_code == 201
    assert report.json()["sales_count"] == 2
    assert Decimal(report.json()["cash_total"]) == Decimal("3")
