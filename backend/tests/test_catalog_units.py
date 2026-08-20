"""Units (a managed list for the "unidad base" picker) and SKU
auto-generation — both added after the 22-phase plan closed, at the
user's request: no more typing an internal tracking number, and no more
a free-text unit field."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


def _product_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "Leche 1L",
        "base_unit_name": "BRIK",
        "cost": "0.60",
        "list_price": "0.95",
        "min_stock": "10",
    }
    payload.update(overrides)
    return payload


async def test_standard_units_are_always_listed_and_admin_can_add_custom_ones(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    initial_names = {unit["name"] for unit in (await client.get("/api/v1/units")).json()}
    assert {"KG", "L", "UDS"} <= initial_names

    create_response = await client.post("/api/v1/units", json={"name": "BARRA"})
    assert create_response.status_code == 201
    assert create_response.json()["name"] == "BARRA"

    list_response = await client.get("/api/v1/units")
    assert list_response.status_code == 200
    assert {"KG", "L", "UDS", "BARRA"} <= {u["name"] for u in list_response.json()}


async def test_duplicate_unit_name_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post("/api/v1/units", json={"name": "L"})

    assert response.status_code == 409


async def test_unused_custom_unit_can_be_renamed_and_deleted(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    created = await client.post("/api/v1/units", json={"name": "CAJA"})
    unit_id = created.json()["id"]

    renamed = await client.patch(f"/api/v1/units/{unit_id}", json={"name": "BANDEJA"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "BANDEJA"

    deleted = await client.delete(f"/api/v1/units/{unit_id}")
    assert deleted.status_code == 204
    assert "BANDEJA" not in {unit["name"] for unit in (await client.get("/api/v1/units")).json()}


async def test_required_unit_cannot_be_deleted_but_used_custom_unit_can(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    kg = next(unit for unit in (await client.get("/api/v1/units")).json() if unit["name"] == "KG")
    assert (
        await client.patch(f"/api/v1/units/{kg['id']}", json={"name": "KILOS"})
    ).status_code == 409
    assert (await client.delete(f"/api/v1/units/{kg['id']}")).status_code == 409

    created = await client.post("/api/v1/units", json={"name": "CAJA"})
    category = await client.post(
        "/api/v1/product-categories",
        json={"name": "Con cajas", "default_unit_name": "CAJA"},
    )
    assert category.status_code == 201
    product = await client.post("/api/v1/products", json=_product_payload(base_unit_name="CAJA"))
    assert product.status_code == 201
    unit_id = created.json()["id"]
    # Renombrar sigue bloqueado: cambiaría el significado de cantidades
    # históricas que ya se expresan como CAJA.
    assert (
        await client.patch(f"/api/v1/units/{unit_id}", json={"name": "BANDEJA"})
    ).status_code == 409

    # Borrar sí es seguro: la unidad deja de ser seleccionable para altas
    # nuevas, se limpia el valor por defecto de categorías, y los productos
    # existentes preservan el texto de su unidad base.
    assert (await client.delete(f"/api/v1/units/{unit_id}")).status_code == 204
    assert "CAJA" not in {unit["name"] for unit in (await client.get("/api/v1/units")).json()}
    updated_category = next(
        item
        for item in (await client.get("/api/v1/product-categories")).json()
        if item["id"] == category.json()["id"]
    )
    assert updated_category["default_unit_name"] is None
    assert (await client.get(f"/api/v1/products/{product.json()['id']}")).json()[
        "base_unit_name"
    ] == "CAJA"


async def test_creating_a_product_without_a_sku_autogenerates_one(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """The admin panel never sends `sku` any more — the person creating a
    product never types an internal tracking number."""
    await login(role_name="ADMIN")

    response = await client.post("/api/v1/products", json=_product_payload())

    assert response.status_code == 201
    sku = response.json()["sku"]
    assert re.fullmatch(r"P\d{6}", sku), sku


async def test_an_explicit_sku_is_still_honoured(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Scripts/imports can still pass one explicitly — unchanged from
    before this feature, uniqueness still enforced."""
    await login(role_name="ADMIN")

    first = await client.post("/api/v1/products", json=_product_payload(sku="IMPORT-1"))
    assert first.status_code == 201
    assert first.json()["sku"] == "IMPORT-1"

    duplicate = await client.post("/api/v1/products", json=_product_payload(sku="IMPORT-1"))
    assert duplicate.status_code == 409


async def test_two_autogenerated_skus_never_collide(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    first = await client.post("/api/v1/products", json=_product_payload(name="Producto A"))
    second = await client.post("/api/v1/products", json=_product_payload(name="Producto B"))

    assert first.json()["sku"] != second.json()["sku"]


async def test_base_unit_can_be_corrected_before_the_product_has_history(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (await client.post("/api/v1/products", json=_product_payload())).json()

    corrected = await client.patch(
        f"/api/v1/products/{product['id']}", json={"base_unit_name": "UDS"}
    )

    assert corrected.status_code == 200
    assert corrected.json()["base_unit_name"] == "UDS"
    base_package = next(package for package in corrected.json()["packages"] if package["is_base"])
    assert base_package["name"] == "UDS"


async def test_base_unit_cannot_change_after_a_stock_movement(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (await client.post("/api/v1/products", json=_product_payload())).json()
    warehouse = next(
        warehouse
        for warehouse in (await client.get("/api/v1/warehouses")).json()
        if warehouse["name"] == "Tienda principal"
    )
    location = next(
        location
        for location in (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
        if location["name"] == "Almacén"
    )
    movement = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse["id"],
            "location_id": location["id"],
            "movement_type": "ADJUSTMENT",
            "quantity": "1",
            "unit_cost": "0.60",
        },
    )
    assert movement.status_code == 201

    rejected = await client.patch(
        f"/api/v1/products/{product['id']}", json={"base_unit_name": "KG"}
    )

    assert rejected.status_code == 409
    assert "unidad base" in rejected.json()["error"]["message"]


async def test_new_units_are_appended_to_the_end_of_the_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    await client.post("/api/v1/units", json={"name": "ORDER-A"})
    await client.post("/api/v1/units", json={"name": "ORDER-B"})

    names = [u["name"] for u in (await client.get("/api/v1/units")).json()]
    assert names.index("ORDER-A") < names.index("ORDER-B")


async def test_moving_a_unit_up_and_down_reorders_the_list(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await client.post("/api/v1/units", json={"name": "MOVE-FIRST"})
    second_id = (await client.post("/api/v1/units", json={"name": "MOVE-SECOND"})).json()["id"]

    response = await client.post(f"/api/v1/units/{second_id}/move", json={"direction": "up"})

    assert response.status_code == 200
    names = [u["name"] for u in response.json()]
    assert names.index("MOVE-SECOND") < names.index("MOVE-FIRST")

    # Y de vuelta hacia abajo, queda como al principio.
    back = await client.post(f"/api/v1/units/{second_id}/move", json={"direction": "down"})
    names_back = [u["name"] for u in back.json()]
    assert names_back.index("MOVE-FIRST") < names_back.index("MOVE-SECOND")


async def test_moving_the_last_unit_down_is_a_safe_no_op(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Las unidades nuevas se añaden al final (ver test de arriba), así
    que la recién creada ya está en el último puesto — bajarla no debe
    fallar ni cambiar nada."""
    await login(role_name="ADMIN")
    last_id = (await client.post("/api/v1/units", json={"name": "EDGE-LAST"})).json()["id"]

    response = await client.post(f"/api/v1/units/{last_id}/move", json={"direction": "down"})

    assert response.status_code == 200
    assert response.json()[-1]["name"] == "EDGE-LAST"
