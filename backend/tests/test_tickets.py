"""Ticket templates and per-sale ticket generation (phase 15)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_product(
    client: AsyncClient, sku: str = "TICKET-TEST-1", **overrides: Any
) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": "Producto de ticket",
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


async def _create_template(
    client: AsyncClient, name: str = "Estándar", **overrides: Any
) -> dict[str, Any]:
    payload = {
        "name": name,
        "width_mm": 58,
        "header_text": "Mi Tienda",
        "footer_text": "Gracias",
        "show_tax_breakdown": True,
    }
    payload.update(overrides)
    response = await client.post("/api/v1/ticket-templates", json=payload)
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def _completed_sale(
    client: AsyncClient, *, product: dict[str, Any], quantity: str = "1"
) -> dict[str, Any]:
    warehouse_id, location_id = await _default_location(client)
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "1.00",
        },
    )
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    added = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={
                "product_id": product["id"],
                "package_id": base_id,
                "quantity_packages": quantity,
            },
        )
    ).json()
    completed = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": added["total"]}]},
    )
    assert completed.status_code == 200
    result: dict[str, Any] = completed.json()
    return result


async def test_creating_a_template_activates_it_and_deactivates_the_previous_one(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    first = await _create_template(client, name="Recibo A")
    assert first["is_active"] is True
    assert first["version"] == 1

    second = await _create_template(client, name="Recibo B")
    assert second["is_active"] is True

    templates = (await client.get("/api/v1/ticket-templates")).json()
    first_now = next(t for t in templates if t["id"] == first["id"])
    assert first_now["is_active"] is False

    active = (await client.get("/api/v1/ticket-templates/active")).json()
    assert active["id"] == second["id"]


async def test_revising_the_active_template_creates_a_new_version(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    template = await _create_template(client)

    response = await client.post(
        f"/api/v1/ticket-templates/{template['id']}/revise",
        json={"width_mm": 80, "header_text": "Nuevo header", "footer_text": "Nuevo footer"},
    )

    assert response.status_code == 200
    revised = response.json()
    assert revised["version"] == 2
    assert revised["width_mm"] == 80
    assert revised["is_active"] is True

    templates = (await client.get("/api/v1/ticket-templates")).json()
    original_now = next(t for t in templates if t["id"] == template["id"])
    assert original_now["is_active"] is False


async def test_revising_an_already_superseded_template_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    template = await _create_template(client)
    await client.post(
        f"/api/v1/ticket-templates/{template['id']}/revise",
        json={"width_mm": 58, "header_text": "", "footer_text": ""},
    )

    response = await client.post(
        f"/api/v1/ticket-templates/{template['id']}/revise",
        json={"width_mm": 58, "header_text": "", "footer_text": ""},
    )

    assert response.status_code == 409


async def test_generating_a_ticket_for_a_completed_sale(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await _create_template(client, header_text="Mi Tienda")
    product = await _create_product(client, sku="TICKET-GEN", list_price="10.00", tax_rate="21")
    sale = await _completed_sale(client, product=product)

    response = await client.post(f"/api/v1/sales/{sale['id']}/tickets")

    assert response.status_code == 201
    ticket = response.json()
    assert ticket["sale_id"] == sale["id"]
    assert "Mi Tienda" in ticket["rendered_text"]
    assert "Producto de ticket" in ticket["rendered_text"]


async def test_generating_a_ticket_twice_is_idempotent_and_frozen(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await _create_template(client, header_text="Cabecera original")
    product = await _create_product(client, sku="TICKET-IDEMPOTENT")
    sale = await _completed_sale(client, product=product)

    first = await client.post(f"/api/v1/sales/{sale['id']}/tickets")
    assert first.status_code == 201
    first_body = first.json()

    # Change the store's receipt look entirely — the already-generated
    # ticket must not reflect it.
    await _create_template(client, name="Otro", header_text="Cabecera nueva")

    second = await client.post(f"/api/v1/sales/{sale['id']}/tickets")

    assert second.status_code == 201
    second_body = second.json()
    assert second_body["id"] == first_body["id"]
    assert second_body["rendered_text"] == first_body["rendered_text"]
    assert "Cabecera original" in second_body["rendered_text"]
    assert "Cabecera nueva" not in second_body["rendered_text"]


async def test_cannot_generate_a_ticket_for_a_draft_sale(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await _create_template(client)
    warehouse_id, location_id = await _default_location(client)
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()

    response = await client.post(f"/api/v1/sales/{sale['id']}/tickets")

    assert response.status_code == 422


async def test_cannot_generate_a_ticket_without_an_active_template(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="TICKET-NOTEMPLATE")
    sale = await _completed_sale(client, product=product)

    response = await client.post(f"/api/v1/sales/{sale['id']}/tickets")

    assert response.status_code == 422


async def test_get_ticket_before_generation_is_404(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await _create_template(client)
    product = await _create_product(client, sku="TICKET-404")
    sale = await _completed_sale(client, product=product)

    response = await client.get(f"/api/v1/sales/{sale['id']}/ticket")

    assert response.status_code == 404


async def test_get_ticket_after_generation_matches(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await _create_template(client)
    product = await _create_product(client, sku="TICKET-GET")
    sale = await _completed_sale(client, product=product)
    generated = (await client.post(f"/api/v1/sales/{sale['id']}/tickets")).json()

    response = await client.get(f"/api/v1/sales/{sale['id']}/ticket")

    assert response.status_code == 200
    assert response.json()["id"] == generated["id"]


async def test_cashier_can_generate_and_read_tickets_but_not_manage_templates(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await _create_template(client)
    product = await _create_product(client, sku="TICKET-CASHIER")
    sale = await _completed_sale(client, product=product)

    await login(role_name="CASHIER")
    assert (
        await client.post(
            "/api/v1/ticket-templates",
            json={"name": "X", "width_mm": 58, "header_text": "", "footer_text": ""},
        )
    ).status_code == 403

    generated = await client.post(f"/api/v1/sales/{sale['id']}/tickets")
    assert generated.status_code == 201
    assert (await client.get(f"/api/v1/sales/{sale['id']}/ticket")).status_code == 200


async def test_ticket_notes_prices_include_tax_when_the_store_setting_is_on(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    default_formula = (await client.get("/api/v1/pricing/settings")).json()["formula"]
    assert (
        await client.put(
            "/api/v1/pricing/settings",
            json={"formula": default_formula, "prices_include_tax": True},
        )
    ).status_code == 200
    try:
        await _create_template(client, header_text="Mi Tienda", show_tax_breakdown=True)
        product = await _create_product(
            client, sku="TICKET-TAX-INCL", list_price="12.10", tax_rate="21"
        )
        sale = await _completed_sale(client, product=product, quantity="1")

        response = await client.post(f"/api/v1/sales/{sale['id']}/tickets")

        assert response.status_code == 201
        text = response.json()["rendered_text"]
        assert "Precios con IVA incluido" in text
        assert "12.10" in text  # el total cobrado, no 12.10 + IVA aparte
    finally:
        await login(role_name="ADMIN")
        await client.put(
            "/api/v1/pricing/settings",
            json={
                "formula": (await client.get("/api/v1/pricing/settings")).json()["formula"],
                "prices_include_tax": False,
            },
        )


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/ticket-templates")

    assert response.status_code == 401
