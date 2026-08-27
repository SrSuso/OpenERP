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
        "printable_width_mm": 48,
        "header_text": "Mi Tienda",
        "footer_text": "Gracias",
        "tax_display": "BREAKDOWN",
    }
    payload.update(overrides)
    response = await client.post("/api/v1/ticket-templates", json=payload)
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def _completed_sale(
    client: AsyncClient,
    *,
    product: dict[str, Any],
    quantity: str = "1",
    cold_drink: bool = False,
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
                "cold_drink": cold_drink,
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


async def test_manager_cannot_manage_ticket_templates(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="MANAGER")

    assert (await client.get("/api/v1/ticket-templates")).status_code == 403
    assert (
        await client.post(
            "/api/v1/ticket-templates",
            json={
                "name": "Manager cannot create",
                "printable_width_mm": 48,
                "header_text": "",
                "footer_text": "",
                "tax_display": "BREAKDOWN",
            },
        )
    ).status_code == 403


async def test_revising_the_active_template_creates_a_new_version(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    template = await _create_template(client)

    response = await client.post(
        f"/api/v1/ticket-templates/{template['id']}/revise",
        json={
            "printable_width_mm": 72,
            "header_text": "Nuevo header",
            "footer_text": "Nuevo footer",
        },
    )

    assert response.status_code == 200
    revised = response.json()
    assert revised["version"] == 2
    assert revised["printable_width_mm"] == 72
    assert revised["is_active"] is True

    templates = (await client.get("/api/v1/ticket-templates")).json()
    original_now = next(t for t in templates if t["id"] == template["id"])
    assert original_now["is_active"] is False


async def test_revising_a_template_that_is_not_in_use_leaves_it_out_of_use(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Se puede corregir una plantilla guardada sin cambiar con cuál
    imprime la caja — para cambiarla está `activate`."""
    await login(role_name="ADMIN")
    retired = await _create_template(client, name="Antigua")
    in_use = await _create_template(client, name="En uso")

    response = await client.post(
        f"/api/v1/ticket-templates/{retired['id']}/revise",
        json={"printable_width_mm": 72, "header_text": "Corregida", "footer_text": ""},
    )

    assert response.status_code == 200
    revised = response.json()
    assert revised["version"] == 2
    assert revised["header_text"] == "Corregida"
    assert revised["is_active"] is False
    # La que estaba en uso sigue estándolo.
    assert (await client.get("/api/v1/ticket-templates/active")).json()["id"] == in_use["id"]


async def test_activating_a_template_switches_which_one_the_till_prints(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    first = await _create_template(client, name="Recibo A")
    second = await _create_template(client, name="Recibo B")
    assert (await client.get("/api/v1/ticket-templates/active")).json()["id"] == second["id"]

    response = await client.post(f"/api/v1/ticket-templates/{first['id']}/activate")

    assert response.status_code == 200
    assert response.json()["is_active"] is True
    assert (await client.get("/api/v1/ticket-templates/active")).json()["id"] == first["id"]
    # Sigue habiendo exactamente una activa.
    templates = (await client.get("/api/v1/ticket-templates")).json()
    assert [t["id"] for t in templates if t["is_active"]] == [first["id"]]


async def test_an_unused_template_can_be_deleted(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    mistaken = await _create_template(client, name="Errónea")
    retained = await _create_template(client, name="Correcta")

    response = await client.delete(f"/api/v1/ticket-templates/{mistaken['id']}")

    assert response.status_code == 204
    templates = (await client.get("/api/v1/ticket-templates")).json()
    assert [template["id"] for template in templates] == [retained["id"]]


async def test_an_active_unused_template_can_be_deleted(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    mistaken = await _create_template(client, name="Única errónea")

    response = await client.delete(f"/api/v1/ticket-templates/{mistaken['id']}")

    assert response.status_code == 204
    assert (await client.get("/api/v1/ticket-templates")).json() == []
    assert (await client.get("/api/v1/ticket-templates/active")).status_code == 422


async def test_generating_a_ticket_for_a_completed_sale(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    template = await _create_template(
        client,
        header_text="Mi Tienda",
        printable_width_mm=64,
        font_family="LIBERATION_MONO",
        font_size_px=10,
        line_height_px=14,
        font_weight="BOLD",
        margin_top_mm=2,
        margin_bottom_mm=3,
    )
    product = await _create_product(client, sku="TICKET-GEN", list_price="10.00", tax_rate="21")
    sale = await _completed_sale(client, product=product)

    response = await client.post(f"/api/v1/sales/{sale['id']}/tickets")

    assert response.status_code == 201
    ticket = response.json()
    assert ticket["sale_id"] == sale["id"]
    assert ticket["template_id"] == template["id"]
    assert {
        key: ticket[key]
        for key in (
            "printable_width_mm",
            "font_family",
            "font_size_px",
            "line_height_px",
            "font_weight",
            "margin_top_mm",
            "margin_bottom_mm",
        )
    } == {
        "printable_width_mm": 64,
        "font_family": "LIBERATION_MONO",
        "font_size_px": 10,
        "line_height_px": 14,
        "font_weight": "BOLD",
        "margin_top_mm": 2,
        "margin_bottom_mm": 3,
    }
    assert "Mi Tienda" in ticket["rendered_text"]
    assert "Producto de ticket" in ticket["rendered_text"]


async def test_ticket_identifies_the_cold_drink_surcharge(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    assert (
        await client.put(
            "/api/v1/settings/options",
            json={"values": {"pos.cold_drink_surcharge_amount": "0.20"}},
        )
    ).status_code == 200
    await _create_template(client)
    product = await _create_product(client, sku="TICKET-COLD-DRINK")
    sale = await _completed_sale(client, product=product, quantity="2", cold_drink=True)

    ticket = (await client.post(f"/api/v1/sales/{sale['id']}/tickets")).json()

    assert "Incluye bebida fría" in ticket["rendered_text"]
    assert "+0.40" in ticket["rendered_text"]


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


async def test_a_template_used_by_a_ticket_can_be_deleted_without_changing_the_receipt(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    template = await _create_template(client, header_text="Histórica")
    product = await _create_product(client, sku="TICKET-DELETE-HISTORY")
    sale = await _completed_sale(client, product=product)
    assert (await client.post(f"/api/v1/sales/{sale['id']}/tickets")).status_code == 201

    original = (await client.post(f"/api/v1/sales/{sale['id']}/tickets")).json()
    response = await client.delete(f"/api/v1/ticket-templates/{template['id']}")

    assert response.status_code == 204
    ticket = (await client.get(f"/api/v1/sales/{sale['id']}/ticket")).json()
    assert ticket["template_id"] is None
    assert ticket["rendered_text"] == original["rendered_text"]
    assert ticket["printable_width_mm"] == original["printable_width_mm"]


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
            json={"name": "X", "printable_width_mm": 48, "header_text": "", "footer_text": ""},
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
        await _create_template(client, header_text="Mi Tienda", tax_display="BREAKDOWN")
        product = await _create_product(
            client, sku="TICKET-TAX-INCL", list_price="12.10", tax_rate="21"
        )
        sale = await _completed_sale(client, product=product, quantity="1")

        response = await client.post(f"/api/v1/sales/{sale['id']}/tickets")

        assert response.status_code == 201
        text = response.json()["rendered_text"]
        # base 10.00 + cuota 2.10 = 12.10, el total cobrado (no 12.10 + IVA aparte)
        row = next(line for line in text.splitlines() if line.startswith("21%"))
        assert "10.00" in row
        assert "2.10" in row
        assert "12.10" in next(line for line in text.splitlines() if line.startswith("TOTAL"))
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
