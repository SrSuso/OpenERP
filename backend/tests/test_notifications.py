"""V2 low-stock and expiration alerts."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import date, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.notifications import service
from app.notifications.models import Incident


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(item for item in warehouses if item["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(item for item in locations if item["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_product(
    client: AsyncClient, *, sku: str, name: str = "Producto", **overrides: Any
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "sku": sku,
        "name": name,
        "base_unit_name": "UDS.",
        "cost": "1",
        "list_price": "2",
        "tax_rate": "0",
    }
    payload.update(overrides)
    response = await client.post("/api/v1/products", json=payload)
    assert response.status_code == 201
    result: dict[str, Any] = response.json()
    return result


async def _stock(
    client: AsyncClient,
    *,
    product_id: int,
    quantity: str,
    lot_id: int | None = None,
) -> None:
    warehouse_id, location_id = await _default_location(client)
    payload: dict[str, Any] = {
        "product_id": product_id,
        "warehouse_id": warehouse_id,
        "location_id": location_id,
        "movement_type": "ADJUSTMENT",
        "quantity": quantity,
        "unit_cost": "1",
    }
    if lot_id is not None:
        payload["lot_id"] = lot_id
    assert (
        await client.post("/api/v1/stock-movements/adjustments", json=payload)
    ).status_code == 201


async def _evaluate(db_session: AsyncSession, settings: Settings) -> list[Incident]:
    return await service.evaluate_rules(db_session, settings)


async def _enable_general_stock(client: AsyncClient, minimum: str = "5") -> None:
    response = await client.put(
        "/api/v1/notification-settings/stock",
        json={"enabled": True, "min_stock": minimum},
    )
    assert response.status_code == 200


async def test_general_stock_threshold_opens_and_auto_resolves(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
    settings: Settings,
) -> None:
    await login(role_name="ADMIN")
    await _enable_general_stock(client, "5")
    product = await _create_product(client, sku="V2-GENERAL")
    assert product["stock_alert_mode"] == "GENERAL"
    await _stock(client, product_id=product["id"], quantity="3")

    await _evaluate(db_session, settings)
    alerts = (await client.get("/api/v1/alerts")).json()
    assert alerts == [
        {
            "id": alerts[0]["id"],
            "kind": "LOW_STOCK",
            "title": "Producto",
            "product_id": product["id"],
            "stock_current": "3.000000",
            "min_stock": "5",
            "replenish": "2.000000",
            "lot_id": None,
            "lot_number": None,
            "expiration_date": None,
            "days_remaining": None,
            "quantity_remaining": None,
        }
    ]

    await _stock(client, product_id=product["id"], quantity="2")
    await _evaluate(db_session, settings)
    assert (await client.get("/api/v1/alerts")).json() == []


async def test_product_at_general_minimum_does_not_alert(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
    settings: Settings,
) -> None:
    await login(role_name="ADMIN")
    await _enable_general_stock(client, "5")
    product = await _create_product(client, sku="V2-EQUAL")
    await _stock(client, product_id=product["id"], quantity="5")
    await _evaluate(db_session, settings)
    assert (await client.get("/api/v1/alerts")).json() == []


async def test_custom_threshold_wins_over_general(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
    settings: Settings,
) -> None:
    await login(role_name="ADMIN")
    await _enable_general_stock(client, "5")
    product = await _create_product(
        client,
        sku="V2-CUSTOM",
        stock_alert_mode="CUSTOM",
        min_stock="10",
    )
    await _stock(client, product_id=product["id"], quantity="7")
    await _evaluate(db_session, settings)
    alert = (await client.get("/api/v1/alerts")).json()[0]
    assert alert["min_stock"] == "10.000000"
    assert alert["replenish"] == "3.000000"

    # The global switch controls GENERAL products, not an explicit product
    # exception. A CUSTOM threshold remains the product's source of truth.
    disabled_general = await client.put(
        "/api/v1/notification-settings/stock",
        json={"enabled": False, "min_stock": "5"},
    )
    assert disabled_general.status_code == 200
    await _evaluate(db_session, settings)
    assert (await client.get("/api/v1/alerts")).json()[0]["product_id"] == product["id"]


async def test_disabled_and_untracked_products_never_alert(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
    settings: Settings,
) -> None:
    await login(role_name="ADMIN")
    await _enable_general_stock(client, "5")
    await _create_product(client, sku="V2-DISABLED", stock_alert_mode="DISABLED")
    await _create_product(client, sku="V2-UNTRACKED", tracks_stock=False)
    await _evaluate(db_session, settings)
    assert (await client.get("/api/v1/alerts")).json() == []


async def test_evaluation_deduplicates_the_internal_incident(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
    settings: Settings,
) -> None:
    await login(role_name="ADMIN")
    await _enable_general_stock(client, "5")
    product = await _create_product(client, sku="V2-DEDUP")
    await _stock(client, product_id=product["id"], quantity="1")
    await _evaluate(db_session, settings)
    await _evaluate(db_session, settings)
    incidents = list(
        (
            await db_session.execute(
                select(Incident).where(
                    Incident.subject_type == "product",
                    Incident.subject_id == product["id"],
                    Incident.status == "OPEN",
                )
            )
        ).scalars()
    )
    assert len(incidents) == 1


async def _create_expiring_lot(
    client: AsyncClient,
    *,
    product_id: int,
    lot_number: str,
    days: int,
) -> int:
    lot_response = await client.post(
        "/api/v1/lots",
        json={
            "product_id": product_id,
            "lot_number": lot_number,
            "expiration_date": (date.today() + timedelta(days=days)).isoformat(),
        },
    )
    assert lot_response.status_code == 201
    lot_id: int = lot_response.json()["id"]
    await _stock(client, product_id=product_id, quantity="2", lot_id=lot_id)
    return lot_id


async def test_product_expiration_overrides_general_and_shares_settings(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
    settings: Settings,
) -> None:
    await login(role_name="ADMIN")
    yogurt = await _create_product(
        client,
        sku="V2-YOGURT",
        name="Yogur",
        track_lots=True,
        track_expiration=True,
    )
    milk = await _create_product(
        client,
        sku="V2-MILK",
        name="Leche",
        track_lots=True,
        track_expiration=True,
    )
    cookies = await _create_product(
        client,
        sku="V2-COOKIES",
        name="Galletas",
        track_lots=True,
        track_expiration=True,
    )
    yogurt_four = await _create_expiring_lot(
        client, product_id=yogurt["id"], lot_number="Y-4", days=4
    )
    yogurt_two = await _create_expiring_lot(
        client, product_id=yogurt["id"], lot_number="Y-2", days=2
    )
    milk_seven = await _create_expiring_lot(client, product_id=milk["id"], lot_number="M-7", days=7)
    cookies_four = await _create_expiring_lot(
        client, product_id=cookies["id"], lot_number="C-4", days=4
    )
    assert (
        await client.put(
            "/api/v1/notification-settings/expiration/general",
            json={"enabled": True, "days_before_expiration": 5},
        )
    ).status_code == 200
    for product_id, days in ((yogurt["id"], 2), (milk["id"], 7)):
        assert (
            await client.put(
                f"/api/v1/notification-settings/expiration/products/{product_id}",
                json={"days_before_expiration": days},
            )
        ).status_code == 200

    await _evaluate(db_session, settings)
    alerts = (await client.get("/api/v1/alerts")).json()
    alerted_lots = {item["lot_id"] for item in alerts if item["kind"] == "EXPIRATION"}
    assert yogurt_four not in alerted_lots
    assert {yogurt_two, milk_seven, cookies_four} <= alerted_lots

    stored = (await client.get("/api/v1/notification-settings")).json()
    assert stored["general_expiration"] == {
        "enabled": True,
        "days_before_expiration": 5,
    }
    stored_exceptions = [
        (item["product_name"], item["days_before_expiration"])
        for item in stored["product_expirations"]
    ]
    assert stored_exceptions == [
        ("Leche", 7),
        ("Yogur", 2),
    ]


async def test_expiration_ignores_products_without_expiration_control(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
    settings: Settings,
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="V2-NO-EXP", track_lots=True)
    await _create_expiring_lot(client, product_id=product["id"], lot_number="NO-EXP", days=1)
    await client.put(
        "/api/v1/notification-settings/expiration/general",
        json={"enabled": True, "days_before_expiration": 5},
    )
    await _evaluate(db_session, settings)
    assert (await client.get("/api/v1/alerts")).json() == []


async def test_legacy_rule_and_manual_incident_endpoints_are_gone(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    assert (await client.get("/api/v1/notification-rules")).status_code == 404
    assert (await client.get("/api/v1/notification-fields")).status_code == 404
    assert (await client.post("/api/v1/notifications/evaluate")).status_code == 404
    assert (await client.get("/api/v1/incidents")).status_code == 404


async def test_cashier_cannot_read_or_change_alert_settings(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")
    assert (await client.get("/api/v1/alerts")).status_code == 403
    assert (await client.get("/api/v1/notification-settings")).status_code == 403
    assert (
        await client.put(
            "/api/v1/notification-settings/stock",
            json={"enabled": True, "min_stock": "5"},
        )
    ).status_code == 403
