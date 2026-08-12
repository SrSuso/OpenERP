"""The registry-backed settings API (`app.settings.options_router`)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def _options(client: AsyncClient) -> dict[str, dict[str, Any]]:
    response = await client.get("/api/v1/settings/options")
    assert response.status_code == 200
    return {s["key"]: s for s in response.json()["settings"]}


async def test_options_serve_the_catalogue_with_current_values(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get("/api/v1/settings/options")

    assert response.status_code == 200
    body = response.json()
    # Los grupos vienen ordenados para que el panel pinte las tarjetas sin
    # decidir nada por su cuenta.
    assert "Datos de la tienda" in body["groups"]
    assert "Caja (TPV)" in body["groups"]
    total = body["settings"][0]
    assert {"key", "group", "label", "help", "type", "value", "default"} <= set(total)


async def test_saving_only_touches_the_keys_sent(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await client.put(
        "/api/v1/settings/options",
        json={"values": {"app.display_name": "Alimentación Pepe", "pos.weighed_units": "KG,L"}},
    )

    response = await client.put(
        "/api/v1/settings/options", json={"values": {"sales.max_discount_rate": "15"}}
    )

    assert response.status_code == 200
    options = {s["key"]: s for s in response.json()["settings"]}
    assert options["sales.max_discount_rate"]["value"] == "15"
    # Lo guardado antes sigue ahí: guardar una tarjeta no borra las otras.
    assert options["app.display_name"]["value"] == "Alimentación Pepe"
    assert options["pos.weighed_units"]["value"] == "KG,L"


async def test_an_unchanged_option_reports_the_registry_default(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    options = await _options(client)

    assert options["pos.weighed_units"]["value"] == "KG"
    assert options["pos.weighed_units"]["default"] == "KG"


async def test_a_bad_value_is_rejected_with_a_message_for_a_human(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.put(
        "/api/v1/settings/options",
        json={"values": {"notifications.default_expiration_days": "no soy un número"}},
    )

    assert response.status_code == 422
    message = response.json()["error"]["message"]
    assert "Días de antelación" in message
    assert "número entero" in message


async def test_an_out_of_range_value_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.put(
        "/api/v1/settings/options", json={"values": {"sales.max_discount_rate": "150"}}
    )

    assert response.status_code == 422
    assert "100" in response.json()["error"]["message"]


async def test_the_whole_batch_is_rejected_if_one_value_is_wrong(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Una pantalla de cambios se guarda entera o no se guarda: media
    tarjeta aplicada sería peor que un error."""
    await login(role_name="ADMIN")

    response = await client.put(
        "/api/v1/settings/options",
        json={"values": {"app.display_name": "Válido", "sales.max_discount_rate": "-5"}},
    )

    assert response.status_code == 422
    options = await _options(client)
    assert options["app.display_name"]["value"] == "OpenERP"


async def test_an_unknown_key_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.put("/api/v1/settings/options", json={"values": {"no.existe": "algo"}})

    assert response.status_code == 422


async def test_what_the_template_says_lands_on_the_next_ticket(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """La prueba que de verdad importa: lo que se guarda en la plantilla
    sale impreso — y Configuración ya no pinta nada en el ticket."""
    await login(role_name="ADMIN")
    await client.post(
        "/api/v1/ticket-templates",
        json={
            "name": "Estándar",
            "width_mm": 58,
            "header_text": "",
            "footer_text": "",
            "store_name": "ALIMENTACION PEPE",
            "sale_number_prefix": "Ticket nº ",
        },
    )
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "SETTINGS-TICKET",
                "name": "Agua",
                "base_unit_name": "UD",
                "cost": "1.00",
                "list_price": "2.00",
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
            "quantity": "5",
            "unit_cost": "1.00",
        },
    )
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": wh["id"], "location_id": loc["id"]}
        )
    ).json()
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    added = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
        )
    ).json()
    charged = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/checkout",
            json={"payments": [{"method": "CASH", "amount": added["total"]}]},
        )
    ).json()

    ticket = (await client.post(f"/api/v1/sales/{sale['id']}/tickets")).json()

    assert "ALIMENTACION PEPE" in ticket["rendered_text"]
    # El número impreso es el de venta, no el `id`: sólo coinciden mientras
    # no se haya cancelado ningún carrito por el medio.
    assert f"Ticket nº {charged['number']}" in ticket["rendered_text"]


async def test_a_cashier_can_read_the_values_but_not_the_catalogue_or_the_credentials(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """El TPV necesita el nombre de la tienda y qué forma de pago sale
    marcada, y quien lo usa no tiene `settings.read`. Lo que no puede ver
    por esa puerta es nada sensible: las credenciales de correo siguen
    siendo sólo de ADMIN."""
    await login(role_name="ADMIN")
    await client.put(
        "/api/v1/settings/options", json={"values": {"app.display_name": "ALIMENTACION PEPE"}}
    )

    await login(role_name="CASHIER")
    response = await client.get("/api/v1/settings/values")

    assert response.status_code == 200
    values = response.json()
    assert values["app.display_name"] == "ALIMENTACION PEPE"
    assert values["pos.default_payment_method"] == "CASH"
    # Ni una clave de correo asoma por aquí, y las suyas siguen cerradas.
    assert not [key for key in values if key.startswith("smtp")]
    assert (await client.get("/api/v1/settings/smtp")).status_code == 403


async def test_the_values_endpoint_still_needs_a_session(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/settings/values")).status_code == 401


async def test_cashier_cannot_read_or_change_settings(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/settings/options")).status_code == 403
    assert (
        await client.put("/api/v1/settings/options", json={"values": {"app.display_name": "X"}})
    ).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/settings/options")).status_code == 401
