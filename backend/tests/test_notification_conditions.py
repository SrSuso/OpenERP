"""Reglas escritas con condiciones (`app.notifications.conditions`)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def _stocked_product(client: AsyncClient, *, sku: str, quantity: str) -> dict[str, Any]:
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": sku,
                "name": f"Producto {sku}",
                "base_unit_name": "UD",
                "cost": "1.00",
                "list_price": "10.00",
                "min_stock": "5",
            },
        )
    ).json()
    warehouses = (await client.get("/api/v1/warehouses")).json()
    wh = next(w for w in warehouses if w["name"] == "Tienda principal")
    locs = (await client.get(f"/api/v1/warehouses/{wh['id']}/locations")).json()
    loc = next(location for location in locs if location["name"] == "Almacén")
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": wh["id"],
            "location_id": loc["id"],
            "movement_type": "ADJUSTMENT",
            "quantity": quantity,
            "unit_cost": "1.00",
        },
    )
    result: dict[str, Any] = product
    return result


async def test_the_catalogue_tells_the_panel_what_can_be_asked(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get("/api/v1/notification-fields")

    assert response.status_code == 200
    body = response.json()
    subjects = {s["key"]: s for s in body["subjects"]}
    assert {"PRODUCT", "LOT"} <= set(subjects)
    fields = {f["key"] for f in subjects["PRODUCT"]["fields"]}
    assert {"stock", "min_stock", "stock_minus_min"} <= fields
    assert body["operators"] == ["=", "!=", "<", "<=", ">", ">="]
    assert body["severities"] == ["LOW", "MEDIUM_LOW", "MEDIUM_HIGH", "HIGH"]


async def test_a_rule_written_with_conditions_detects_what_matches(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    low = await _stocked_product(client, sku="COND-LOW", quantity="2")
    plenty = await _stocked_product(client, sku="COND-OK", quantity="50")

    await client.post(
        "/api/v1/notification-rules",
        json={
            "name": "Stock por debajo de 5",
            "rule_type": "CONDITION",
            "severity": "HIGH",
            "params": {
                "subject": "PRODUCT",
                "conditions": [{"field": "stock", "operator": "<", "value": 5}],
            },
        },
    )

    incidents = (await client.post("/api/v1/notifications/evaluate")).json()

    subjects = {i["subject_id"] for i in incidents}
    assert low["id"] in subjects
    assert plenty["id"] not in subjects
    # La criticidad viaja con el aviso, para que el panel pueda destacarlo.
    condition_incidents = [
        incident
        for incident in incidents
        if incident["subject_id"] == low["id"] and incident["rule_type"] == "CONDITION"
    ]
    assert condition_incidents
    assert all(incident["severity"] == "HIGH" for incident in condition_incidents)


async def test_several_conditions_all_have_to_hold(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    cheap = await _stocked_product(client, sku="COND-AND", quantity="2")

    await client.post(
        "/api/v1/notification-rules",
        json={
            "name": "Poco stock y caro",
            "rule_type": "CONDITION",
            "params": {
                "subject": "PRODUCT",
                "conditions": [
                    {"field": "stock", "operator": "<", "value": 5},
                    {"field": "list_price", "operator": ">", "value": 1000},
                ],
            },
        },
    )

    incidents = (await client.post("/api/v1/notifications/evaluate")).json()

    condition_subjects = {
        incident["subject_id"] for incident in incidents if incident["rule_type"] == "CONDITION"
    }
    assert cheap["id"] not in condition_subjects


async def test_an_invented_field_or_operator_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Regla 13: lo que se guarda son claves de la lista blanca, nunca SQL."""
    await login(role_name="ADMIN")
    await client.post(
        "/api/v1/notification-rules",
        json={
            "name": "Inventada",
            "rule_type": "CONDITION",
            "params": {
                "subject": "PRODUCT",
                "conditions": [{"field": "1=1; DROP TABLE products", "operator": "<", "value": 1}],
            },
        },
    )

    response = await client.post("/api/v1/notifications/evaluate")

    assert response.status_code == 422
    assert "desconocido" in response.json()["error"]["message"]
