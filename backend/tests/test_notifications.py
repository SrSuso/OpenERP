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


async def test_low_stock_rule_detects_a_product_below_its_minimum(
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
    await _create_rule(client, name="Stock bajo", rule_type="LOW_STOCK")

    incidents = await _evaluate(client)

    incident = _incident_for(incidents, "product", product["id"])
    assert incident is not None
    assert incident["status"] == "OPEN"
    assert "Producto de notificación" in incident["message"]
    assert "NOTIF-LOW" not in incident["message"]


async def test_low_stock_rule_does_not_flag_a_product_above_its_minimum(
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
        quantity="50",
    )
    await _create_rule(client, name="Stock bajo", rule_type="LOW_STOCK")

    incidents = await _evaluate(client)

    assert _incident_for(incidents, "product", product["id"]) is None


async def test_low_stock_rule_ignores_a_product_without_stock_control(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un producto que no se agota está siempre a 0 y siempre por debajo
    del mínimo que tuviera puesto de antes, y no hay forma de reponerlo:
    el aviso se quedaría abierto para siempre, mandando correo, hasta que
    nadie mire ninguno."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-NOSTOCK", min_stock="10")
    await client.patch(f"/api/v1/products/{product['id']}", json={"tracks_stock": False})
    await _create_rule(client, name="Stock bajo", rule_type="LOW_STOCK")

    incidents = await _evaluate(client)

    assert _incident_for(incidents, "product", product["id"]) is None


async def test_low_stock_rule_ignores_one_whose_category_turned_it_off(
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
    await _create_rule(client, name="Stock bajo", rule_type="LOW_STOCK")

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
    await _create_rule(client, name="Stock bajo", rule_type="LOW_STOCK")

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
    await _create_rule(client, name="Stock bajo", rule_type="LOW_STOCK")
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


async def test_creating_a_rule_with_params_that_do_not_fit_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/notification-rules",
        json={"name": "x", "rule_type": "EXPIRING_LOT", "params": {"days_before_expiration": -1}},
    )

    assert response.status_code == 422


async def test_deactivating_a_rule_excludes_it_from_evaluation(
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

    assert _incident_for(incidents, "product", product["id"]) is None


async def test_deleting_a_rule_removes_its_derived_incidents(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="NOTIF-DELETE", min_stock="10")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="1",
    )
    rule = await _create_rule(client, name="Borrar stock bajo", rule_type="LOW_STOCK")
    incident = _incident_for(await _evaluate(client), "product", product["id"])
    assert incident is not None

    response = await client.delete(f"/api/v1/notification-rules/{rule['id']}")

    assert response.status_code == 204
    assert (await client.get("/api/v1/notification-rules")).json() == []
    assert (await client.get(f"/api/v1/incidents/{incident['id']}")).status_code == 404


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
