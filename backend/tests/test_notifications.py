"""Notification rules and incidents (phase 17): detect, deduplicate,
auto-resolve — see app.notifications.models for the contract."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from httpx import AsyncClient

from app.core.config import Settings

MAILPIT_API = "http://127.0.0.1:8025/api/v1"


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_product(
    client: AsyncClient, sku: str = "NOTIF-TEST-1", **overrides: Any
) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": "Producto de notificación",
        "base_unit_name": "UNIDAD",
        "cost": "1.00",
        "list_price": "10.00",
        "tax_rate": "0",
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


async def _create_rule(
    client: AsyncClient, *, name: str, rule_type: str, params: dict[str, Any] | None = None
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/notification-rules",
        json={"name": name, "rule_type": rule_type, "params": params or {}},
    )
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def _create_expiring_product(client: AsyncClient, *, sku: str, name: str) -> dict[str, Any]:
    return await _create_product(
        client,
        sku=sku,
        name=name,
        track_lots=True,
        track_expiration=True,
    )


async def _create_lot(
    client: AsyncClient,
    *,
    product_id: int,
    number: str,
    days_until_expiration: int,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/lots",
        json={
            "product_id": product_id,
            "lot_number": number,
            "expiration_date": (date.today() + timedelta(days=days_until_expiration)).isoformat(),
        },
    )
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def _evaluate(client: AsyncClient) -> list[dict[str, Any]]:
    response = await client.post("/api/v1/notifications/evaluate")
    assert response.status_code == 200
    result: list[dict[str, Any]] = response.json()
    return result


def _incident_for(
    incidents: list[dict[str, Any]], subject_type: str, subject_id: int
) -> dict[str, Any] | None:
    return next(
        (
            i
            for i in incidents
            if i["subject_type"] == subject_type and i["subject_id"] == subject_id
        ),
        None,
    )


async def test_low_stock_is_automatic_below_the_product_minimum(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-LOW", min_stock="10")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="3",
    )
    incidents = await _evaluate(client)

    incident = _incident_for(incidents, "product", product["id"])
    assert incident is not None
    assert incident["status"] == "OPEN"
    assert "Producto de notificación" in incident["message"]
    assert "stock actual 3" in incident["message"]
    assert "mínimo 10" in incident["message"]
    assert "reponer 7" in incident["message"]
    assert "NOTIF-LOW" not in incident["message"]

    alerts = (await client.get("/api/v1/alerts")).json()
    alert = next(item for item in alerts if item["product_id"] == product["id"])
    assert alert == {
        "id": incident["id"],
        "kind": "LOW_STOCK",
        "title": "Producto de notificación",
        "message": None,
        "severity": "MEDIUM_HIGH",
        "product_id": product["id"],
        "stock_current": "3.000000",
        "min_stock": "10.000000",
        "replenish": "7.000000",
        "lot_id": None,
        "lot_number": None,
        "expiration_date": None,
        "days_remaining": None,
        "quantity_remaining": None,
    }


async def test_low_stock_does_not_flag_a_product_at_its_minimum(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-OK", min_stock="5")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="5",
    )

    incidents = await _evaluate(client)

    assert _incident_for(incidents, "product", product["id"]) is None


async def test_low_stock_ignores_zero_minimum(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-ZERO-MIN", min_stock="0")

    incidents = await _evaluate(client)

    assert _incident_for(incidents, "product", product["id"]) is None


async def test_low_stock_ignores_a_product_without_stock_control(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un producto que no se agota está siempre a 0 y siempre por debajo
    del mínimo que tuviera puesto de antes, y no hay forma de reponerlo:
    el aviso se quedaría abierto para siempre, mandando correo, hasta que
    nadie mire ninguno."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-NOSTOCK", min_stock="10")
    await client.patch(f"/api/v1/products/{product['id']}", json={"tracks_stock": False})
    incidents = await _evaluate(client)

    assert _incident_for(incidents, "product", product["id"]) is None


async def test_low_stock_ignores_one_whose_category_turned_it_off(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """La decisión se hereda igual que el margen: si la categoría dice que
    no se lleva stock, sus productos tampoco avisan."""
    await login(role_name="ADMIN")
    category_id = (
        await client.post("/api/v1/product-categories", json={"name": "A granel (avisos)"})
    ).json()["id"]
    await client.patch(
        f"/api/v1/product-categories/{category_id}",
        json={"name": "A granel (avisos)", "tracks_stock": False},
    )
    product = await _create_product(
        client, sku="NOTIF-CAT-NOSTOCK", min_stock="10", category_id=category_id
    )
    incidents = await _evaluate(client)

    assert _incident_for(incidents, "product", product["id"]) is None


async def test_evaluating_twice_does_not_duplicate_the_incident(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-DEDUP", min_stock="10")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="1",
    )
    first = _incident_for(await _evaluate(client), "product", product["id"])
    second = _incident_for(await _evaluate(client), "product", product["id"])

    assert first is not None
    assert second is not None
    assert first["id"] == second["id"]
    assert second["last_seen_at"] >= first["last_seen_at"]

    open_incidents = (await client.get("/api/v1/incidents", params={"status": "OPEN"})).json()
    matching = [
        i
        for i in open_incidents
        if i["subject_type"] == "product" and i["subject_id"] == product["id"]
    ]
    assert len(matching) == 1


async def test_incident_auto_resolves_once_the_condition_clears(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-CLEARS", min_stock="10")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="1",
    )
    opened = _incident_for(await _evaluate(client), "product", product["id"])
    assert opened is not None

    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="100",
    )
    await _evaluate(client)

    resolved = (await client.get(f"/api/v1/incidents/{opened['id']}")).json()
    assert resolved["status"] == "RESOLVED"
    assert resolved["resolved_at"] is not None


async def test_expiring_lot_rule_detects_a_lot_within_the_window(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "NOTIF-LOT",
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
    soon = (date.today() + timedelta(days=2)).isoformat()
    far = (date.today() + timedelta(days=300)).isoformat()
    lot_soon = (
        await client.post(
            "/api/v1/lots",
            json={"product_id": product["id"], "lot_number": "NOTIF-SOON", "expiration_date": soon},
        )
    ).json()
    lot_far = (
        await client.post(
            "/api/v1/lots",
            json={"product_id": product["id"], "lot_number": "NOTIF-FAR", "expiration_date": far},
        )
    ).json()
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="5",
        lot_id=lot_soon["id"],
    )
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="5",
        lot_id=lot_far["id"],
    )
    await _create_rule(
        client, name="Caducidad", rule_type="EXPIRING_LOT", params={"days_before_expiration": 7}
    )

    incidents = await _evaluate(client)

    assert _incident_for(incidents, "lot", lot_soon["id"]) is not None
    assert _incident_for(incidents, "lot", lot_far["id"]) is None


async def test_product_expiration_completely_overrides_the_general_window(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    yogurt = await _create_expiring_product(client, sku="EXP-YOGURT", name="Yogur natural")
    cookies = await _create_expiring_product(client, sku="EXP-COOKIES", name="Galletas")
    yogurt_at_four = await _create_lot(
        client, product_id=yogurt["id"], number="YOG-4", days_until_expiration=4
    )
    yogurt_at_two = await _create_lot(
        client, product_id=yogurt["id"], number="YOG-2", days_until_expiration=2
    )
    cookies_at_four = await _create_lot(
        client, product_id=cookies["id"], number="GAL-4", days_until_expiration=4
    )
    for product, lot in (
        (yogurt, yogurt_at_four),
        (yogurt, yogurt_at_two),
        (cookies, cookies_at_four),
    ):
        await _stock(
            client,
            product_id=product["id"],
            warehouse_id=warehouse_id,
            location_id=location_id,
            quantity="5",
            lot_id=lot["id"],
        )

    general = await client.put(
        "/api/v1/notification-settings/expiration/general",
        json={"enabled": True, "days_before_expiration": 5},
    )
    specific = await client.put(
        f"/api/v1/notification-settings/expiration/products/{yogurt['id']}",
        json={"days_before_expiration": 2},
    )
    assert general.status_code == 200
    assert specific.status_code == 200

    first = await _evaluate(client)

    assert _incident_for(first, "lot", yogurt_at_four["id"]) is None
    yogurt_incident = _incident_for(first, "lot", yogurt_at_two["id"])
    cookies_incident = _incident_for(first, "lot", cookies_at_four["id"])
    assert yogurt_incident is not None
    assert cookies_incident is not None

    await _evaluate(client)
    open_incidents = (await client.get("/api/v1/incidents", params={"status": "OPEN"})).json()
    for lot, expected_id in (
        (yogurt_at_two, yogurt_incident["id"]),
        (cookies_at_four, cookies_incident["id"]),
    ):
        matches = [
            incident
            for incident in open_incidents
            if incident["subject_type"] == "lot" and incident["subject_id"] == lot["id"]
        ]
        assert [incident["id"] for incident in matches] == [expected_id]

    stored = specific.json()
    assert stored["general_expiration"] == {
        "enabled": True,
        "days_before_expiration": 5,
    }
    assert stored["product_expirations"] == [
        {
            "product_id": yogurt["id"],
            "product_name": "Yogur natural",
            "days_before_expiration": 2,
        }
    ]


async def test_two_product_windows_work_without_a_general_rule(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    yogurt = await _create_expiring_product(client, sku="EXP-YOG-ONLY", name="Yogur")
    milk = await _create_expiring_product(client, sku="EXP-MILK", name="Leche")
    cheese = await _create_expiring_product(client, sku="EXP-CHEESE", name="Queso")
    yogurt_lot = await _create_lot(
        client, product_id=yogurt["id"], number="YOG-ONLY-2", days_until_expiration=2
    )
    milk_lot = await _create_lot(
        client, product_id=milk["id"], number="MILK-7", days_until_expiration=7
    )
    cheese_lot = await _create_lot(
        client, product_id=cheese["id"], number="CHEESE-1", days_until_expiration=1
    )
    for product, lot in ((yogurt, yogurt_lot), (milk, milk_lot), (cheese, cheese_lot)):
        await _stock(
            client,
            product_id=product["id"],
            warehouse_id=warehouse_id,
            location_id=location_id,
            quantity="3",
            lot_id=lot["id"],
        )

    assert (
        await client.put(
            "/api/v1/notification-settings/expiration/general",
            json={"enabled": False, "days_before_expiration": 5},
        )
    ).status_code == 200
    for product, days in ((yogurt, 2), (milk, 7)):
        assert (
            await client.put(
                f"/api/v1/notification-settings/expiration/products/{product['id']}",
                json={"days_before_expiration": days},
            )
        ).status_code == 200

    incidents = await _evaluate(client)

    assert _incident_for(incidents, "lot", yogurt_lot["id"]) is not None
    assert _incident_for(incidents, "lot", milk_lot["id"]) is not None
    assert _incident_for(incidents, "lot", cheese_lot["id"]) is None


async def test_expiration_ignores_empty_lots_and_auto_resolves_consumed_stock(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    product = await _create_expiring_product(client, sku="EXP-LOTS", name="Postre fresco")
    first_lot = await _create_lot(
        client, product_id=product["id"], number="FRESH-1", days_until_expiration=2
    )
    second_lot = await _create_lot(
        client, product_id=product["id"], number="FRESH-2", days_until_expiration=3
    )
    empty_lot = await _create_lot(
        client, product_id=product["id"], number="FRESH-EMPTY", days_until_expiration=1
    )
    for lot in (first_lot, second_lot):
        await _stock(
            client,
            product_id=product["id"],
            warehouse_id=warehouse_id,
            location_id=location_id,
            quantity="5",
            lot_id=lot["id"],
        )
    await client.put(
        "/api/v1/notification-settings/expiration/general",
        json={"enabled": True, "days_before_expiration": 5},
    )

    first = await _evaluate(client)
    first_incident = _incident_for(first, "lot", first_lot["id"])
    second_incident = _incident_for(first, "lot", second_lot["id"])
    assert first_incident is not None
    assert second_incident is not None
    assert _incident_for(first, "lot", empty_lot["id"]) is None

    repeated = await _evaluate(client)
    repeated_first = _incident_for(repeated, "lot", first_lot["id"])
    repeated_second = _incident_for(repeated, "lot", second_lot["id"])
    assert repeated_first is not None
    assert repeated_second is not None
    assert repeated_first["id"] == first_incident["id"]
    assert repeated_second["id"] == second_incident["id"]

    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="-5",
        lot_id=first_lot["id"],
    )
    await _evaluate(client)

    resolved = (await client.get(f"/api/v1/incidents/{first_incident['id']}")).json()
    still_open = (await client.get(f"/api/v1/incidents/{second_incident['id']}")).json()
    assert resolved["status"] == "RESOLVED"
    assert still_open["status"] == "OPEN"


async def test_creating_a_rule_with_params_that_do_not_fit_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/notification-rules",
        json={"name": "x", "rule_type": "EXPIRING_LOT", "params": {"days_before_expiration": -1}},
    )

    assert response.status_code == 422


async def test_deactivating_a_legacy_rule_does_not_disable_automatic_low_stock(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-INACTIVE-RULE", min_stock="10")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="1",
    )
    rule = await _create_rule(client, name="Stock bajo", rule_type="LOW_STOCK")
    await client.patch(f"/api/v1/notification-rules/{rule['id']}", json={"is_active": False})

    incidents = await _evaluate(client)

    assert _incident_for(incidents, "product", product["id"]) is not None
    rules = (await client.get("/api/v1/notification-rules")).json()
    automatic = next(item for item in rules if item["params"].get("automatic") is True)
    assert automatic["is_active"] is True


async def test_manually_resolving_an_incident(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-MANUAL-RESOLVE", min_stock="10")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="1",
    )
    await _create_rule(client, name="Stock bajo", rule_type="LOW_STOCK")
    incident = _incident_for(await _evaluate(client), "product", product["id"])
    assert incident is not None

    response = await client.post(f"/api/v1/incidents/{incident['id']}/resolve")

    assert response.status_code == 200
    assert response.json()["status"] == "RESOLVED"


async def test_cashier_cannot_manage_or_read_notifications(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/notification-rules")).status_code == 403
    assert (await client.post("/api/v1/notifications/evaluate")).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/notification-rules")

    assert response.status_code == 401


async def test_a_brand_new_incident_queues_and_delivers_an_email(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    monkeypatch: pytest.MonkeyPatch,
    settings: Settings,
) -> None:
    """The phase 18 wiring: evaluate_rules queues one email per brand-new
    incident to the process environment's `notification_recipient_email`, if
    configured — verified end to end through a real send via Mailpit, not just
    "a row exists"."""
    to_email = "notify-test@example.invalid"
    monkeypatch.setattr(settings, "notification_recipient_email", to_email)
    async with httpx.AsyncClient() as http:
        await http.delete(f"{MAILPIT_API}/messages")
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-EMAIL", min_stock="10")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="1",
    )
    await _create_rule(client, name="Stock bajo", rule_type="LOW_STOCK")

    await _evaluate(client)
    pending = (await client.get("/api/v1/outbox", params={"status": "PENDING"})).json()
    assert any(message["to_email"] == to_email for message in pending)
    run_response = await client.post("/api/v1/outbox/run")
    assert run_response.status_code == 200
    assert run_response.json()["processed"] >= 1

    async with httpx.AsyncClient() as http:
        search = await http.get(f"{MAILPIT_API}/search", params={"query": f"to:{to_email}"})
    delivered = search.json()["messages"]
    assert len(delivered) == 1
    assert "Stock bajo" in delivered[0]["Subject"]

    # Evaluating again (condition unchanged) must not queue a second email —
    # only a brand-new incident does.
    await _evaluate(client)
    await client.post("/api/v1/outbox/run")
    async with httpx.AsyncClient() as http:
        search_again = await http.get(f"{MAILPIT_API}/search", params={"query": f"to:{to_email}"})
    assert len(search_again.json()["messages"]) == 1
