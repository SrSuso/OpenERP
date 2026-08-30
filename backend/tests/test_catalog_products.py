"""Product catalog: products, packages, barcodes.

Covers the phase 3 acceptance cases from the plan:
  4. Create a product.
  5. Create a "brick" package, factor 1.
  6. Create a "box" package, factor 6.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


def _product_payload(**overrides: Any) -> dict[str, Any]:
    payload = {
        "sku": "MILK-1L",
        "name": "Leche 1L",
        "description": "Leche entera 1 litro",
        "base_unit_name": "BRIK",
        "base_barcode": "111111",
        "cost": "0.60",
        "list_price": "0.95",
        "tax_rate": "4",
        "min_stock": "10",
        "track_lots": True,
        "track_expiration": True,
    }
    payload.update(overrides)
    return payload


async def test_admin_can_create_a_product_with_its_base_package(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post("/api/v1/products", json=_product_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["sku"] == "MILK-1L"
    assert body["is_active"] is True
    assert len(body["packages"]) == 1
    base = body["packages"][0]
    assert base["name"] == "BRIK"
    assert base["factor"] == "1.000000"
    assert base["is_base"] is True
    assert [b["barcode"] for b in base["barcodes"]] == ["111111"]


async def test_expiration_always_enables_lots_and_stock(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Caducidad sin lote ni existencias deja fechas sin unidades a las que
    asociarse, por lo que el servicio corrige también llamadas directas."""
    await login(role_name="ADMIN")
    created = await client.post(
        "/api/v1/products",
        json=_product_payload(track_lots=False, track_expiration=True, tracks_stock=False),
    )

    assert created.status_code == 201
    body = created.json()
    assert body["track_expiration"] is True
    assert body["track_lots"] is True
    assert body["tracks_stock"] is True
    assert body["effective_tracks_stock"] is True

    # Tampoco puede desactivarse lotes o stock mientras siga habiendo
    # caducidad, aunque la petición no vuelva a mencionarla.
    incompatible = await client.patch(
        f"/api/v1/products/{body['id']}",
        json={"track_lots": False, "tracks_stock": False},
    )
    assert incompatible.status_code == 200
    assert incompatible.json()["track_lots"] is True
    assert incompatible.json()["tracks_stock"] is True
    assert incompatible.json()["effective_tracks_stock"] is True


async def test_admin_can_edit_or_clear_the_base_barcode_from_the_product(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (await client.post("/api/v1/products", json=_product_payload())).json()

    changed = await client.patch(
        f"/api/v1/products/{product['id']}", json={"base_barcode": "222222"}
    )
    assert changed.status_code == 200
    base = next(package for package in changed.json()["packages"] if package["is_base"])
    assert [barcode["barcode"] for barcode in base["barcodes"]] == ["222222"]

    cleared = await client.patch(f"/api/v1/products/{product['id']}", json={"base_barcode": None})
    assert cleared.status_code == 200
    base = next(package for package in cleared.json()["packages"] if package["is_base"])
    assert base["barcodes"] == []


async def test_adding_a_box_package_with_factor_6(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = (await client.post("/api/v1/products", json=_product_payload())).json()["id"]

    response = await client.post(
        f"/api/v1/products/{product_id}/packages",
        json={"name": "CAJA 6", "factor": "6", "barcode": "666666"},
    )

    assert response.status_code == 200
    body = response.json()
    packages = {p["name"]: p for p in body["packages"]}
    assert set(packages) == {"BRIK", "CAJA 6"}
    assert packages["CAJA 6"]["factor"] == "6.000000"
    assert packages["CAJA 6"]["is_base"] is False
    assert [b["barcode"] for b in packages["CAJA 6"]["barcodes"]] == ["666666"]


async def test_duplicate_sku_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    payload = _product_payload()

    assert (await client.post("/api/v1/products", json=payload)).status_code == 201

    second = await client.post("/api/v1/products", json={**payload, "base_barcode": "222222"})
    assert second.status_code == 409


async def test_duplicate_barcode_across_products_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await client.post("/api/v1/products", json=_product_payload())

    response = await client.post(
        "/api/v1/products",
        json=_product_payload(sku="MILK-2L", name="Leche 2L", base_barcode="111111"),
    )

    assert response.status_code == 409


async def test_duplicate_package_name_on_same_product_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = (await client.post("/api/v1/products", json=_product_payload())).json()["id"]

    response = await client.post(
        f"/api/v1/products/{product_id}/packages", json={"name": "BRIK", "factor": "1"}
    )

    assert response.status_code == 409


async def test_lookup_product_by_barcode(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = (await client.post("/api/v1/products", json=_product_payload())).json()["id"]
    await client.post(
        f"/api/v1/products/{product_id}/packages",
        json={"name": "CAJA 6", "factor": "6", "barcode": "666666"},
    )

    by_brick = await client.get("/api/v1/products/barcode/111111")
    assert by_brick.status_code == 200
    assert by_brick.json()["id"] == product_id

    by_box = await client.get("/api/v1/products/barcode/666666")
    assert by_box.status_code == 200
    assert by_box.json()["id"] == product_id

    missing = await client.get("/api/v1/products/barcode/000000")
    assert missing.status_code == 404


async def test_admin_can_add_edit_and_delete_a_barcode(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (await client.post("/api/v1/products", json=_product_payload())).json()
    product_id = product["id"]
    package_id = product["packages"][0]["id"]

    added = await client.post(
        f"/api/v1/products/{product_id}/packages/{package_id}/barcodes",
        json={"barcode": "222222"},
    )
    assert added.status_code == 200
    barcodes = added.json()["packages"][0]["barcodes"]
    assert {b["barcode"] for b in barcodes} == {"111111", "222222"}
    barcode_id = next(b["id"] for b in barcodes if b["barcode"] == "222222")

    # Typed wrong, or the manufacturer changed it — edited in place, not
    # deleted and re-added under a new id.
    edited = await client.patch(
        f"/api/v1/products/{product_id}/packages/{package_id}/barcodes/{barcode_id}",
        json={"barcode": "333333"},
    )
    assert edited.status_code == 200
    edited_barcodes = {b["id"]: b["barcode"] for b in edited.json()["packages"][0]["barcodes"]}
    assert edited_barcodes[barcode_id] == "333333"

    # Added by mistake — removed outright.
    deleted = await client.delete(
        f"/api/v1/products/{product_id}/packages/{package_id}/barcodes/{barcode_id}"
    )
    assert deleted.status_code == 200
    remaining = [b["barcode"] for b in deleted.json()["packages"][0]["barcodes"]]
    assert remaining == ["111111"]

    assert (await client.get("/api/v1/products/barcode/333333")).status_code == 404


async def test_editing_a_barcode_to_one_already_used_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (await client.post("/api/v1/products", json=_product_payload())).json()
    product_id = product["id"]
    package_id = product["packages"][0]["id"]
    other = (
        await client.post(
            "/api/v1/products",
            json=_product_payload(sku="MILK-2L", name="Leche 2L", base_barcode="999999"),
        )
    ).json()
    barcode_id = product["packages"][0]["barcodes"][0]["id"]

    response = await client.patch(
        f"/api/v1/products/{product_id}/packages/{package_id}/barcodes/{barcode_id}",
        json={"barcode": "999999"},
    )

    assert response.status_code == 409
    assert other["id"] != product_id  # sólo por claridad de qué producto es "el otro"


async def test_barcode_not_found_on_edit_and_delete(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (await client.post("/api/v1/products", json=_product_payload())).json()
    product_id = product["id"]
    package_id = product["packages"][0]["id"]

    assert (
        await client.patch(
            f"/api/v1/products/{product_id}/packages/{package_id}/barcodes/999999",
            json={"barcode": "555555"},
        )
    ).status_code == 404
    assert (
        await client.delete(f"/api/v1/products/{product_id}/packages/{package_id}/barcodes/999999")
    ).status_code == 404


async def test_cashier_cannot_edit_or_delete_a_barcode(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (await client.post("/api/v1/products", json=_product_payload())).json()
    product_id = product["id"]
    package_id = product["packages"][0]["id"]
    barcode_id = product["packages"][0]["barcodes"][0]["id"]

    await login(role_name="CASHIER")
    assert (
        await client.patch(
            f"/api/v1/products/{product_id}/packages/{package_id}/barcodes/{barcode_id}",
            json={"barcode": "555555"},
        )
    ).status_code == 403
    assert (
        await client.delete(
            f"/api/v1/products/{product_id}/packages/{package_id}/barcodes/{barcode_id}"
        )
    ).status_code == 403


async def test_update_product_and_deactivate(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = (await client.post("/api/v1/products", json=_product_payload())).json()["id"]

    update_response = await client.patch(f"/api/v1/products/{product_id}", json={"min_stock": "25"})
    assert update_response.status_code == 200
    assert update_response.json()["min_stock"] == "25.000000"

    deactivate_response = await client.post(f"/api/v1/products/{product_id}/deactivate")
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["is_active"] is False

    # Deactivated products are hidden from the default (active-only) listing.
    active_list = await client.get("/api/v1/products")
    assert product_id not in {p["id"] for p in active_list.json()}

    full_list = await client.get("/api/v1/products", params={"active_only": False})
    assert product_id in {p["id"] for p in full_list.json()}

    # Rule 14's other half: deactivating never deletes, so it can always be
    # switched back on (sold again, or deactivated by mistake).
    activate_response = await client.post(f"/api/v1/products/{product_id}/activate")
    assert activate_response.status_code == 200
    assert activate_response.json()["is_active"] is True

    active_list_again = await client.get("/api/v1/products")
    assert product_id in {p["id"] for p in active_list_again.json()}


async def test_admin_can_delete_an_unused_product_but_not_one_in_a_sale(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    unused = (await client.post("/api/v1/products", json=_product_payload())).json()

    deleted = await client.delete(f"/api/v1/products/{unused['id']}")
    assert deleted.status_code == 204
    assert (await client.get(f"/api/v1/products/{unused['id']}")).status_code == 404

    used = (
        await client.post(
            "/api/v1/products",
            json=_product_payload(sku="PRODUCT-WITH-SALE", base_barcode="333333"),
        )
    ).json()
    warehouse = next(
        item
        for item in (await client.get("/api/v1/warehouses")).json()
        if item["name"] == "Tienda principal"
    )
    location = next(
        item
        for item in (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
        if item["name"] == "Almacén"
    )
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse["id"], "location_id": location["id"]}
        )
    ).json()
    base_package = next(package for package in used["packages"] if package["is_base"])
    assert (
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={
                "product_id": used["id"],
                "package_id": base_package["id"],
                "quantity_packages": "1",
            },
        )
    ).status_code == 201

    blocked = await client.delete(f"/api/v1/products/{used['id']}")
    assert blocked.status_code == 409
    assert "ventas" in blocked.json()["error"]["message"]
    assert (await client.get(f"/api/v1/products/{used['id']}")).status_code == 200


async def test_admin_can_delete_an_unused_product_with_explicit_taxes(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """El alta del panel puede crear este vínculo en un PATCH de precios.

    Aunque `product_taxes` sea una tabla secundaria, SQLAlchemy ya se encarga
    de retirarla al borrar el producto. Limpiarla aparte y después borrar el
    ORM object hacía que ambas rutas compitieran por la misma fila.
    """
    await login(role_name="ADMIN")
    product = (await client.post("/api/v1/products", json=_product_payload())).json()
    tax = (await client.post("/api/v1/taxes", json={"name": "IVA 21 %", "rate": "21"})).json()

    configured = await client.patch(
        f"/api/v1/products/{product['id']}/pricing", json={"tax_ids": [tax["id"]]}
    )
    assert configured.status_code == 200

    deleted = await client.delete(f"/api/v1/products/{product['id']}")
    assert deleted.status_code == 204
    assert (await client.get(f"/api/v1/products/{product['id']}")).status_code == 404


async def test_cashier_can_read_but_not_manage_products(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/products")).status_code == 200
    assert (await client.post("/api/v1/products", json=_product_payload())).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/products")

    assert response.status_code == 401


async def test_a_category_can_be_hidden_and_shown_again(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Ocultar no borra: la categoría sigue ahí y los productos que la
    tienen asignada la conservan."""
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/product-categories", json={"name": "Temporada"})).json()
    product = (
        await client.post("/api/v1/products", json=_product_payload(category_id=category["id"]))
    ).json()

    hidden = await client.post(f"/api/v1/product-categories/{category['id']}/deactivate")

    assert hidden.status_code == 200
    assert hidden.json()["is_active"] is False
    listed = {c["id"]: c for c in (await client.get("/api/v1/product-categories")).json()}
    assert listed[category["id"]]["is_active"] is False
    # El producto no pierde su clasificación.
    assert (await client.get(f"/api/v1/products/{product['id']}")).json()["category_id"] == (
        category["id"]
    )

    shown = await client.post(f"/api/v1/product-categories/{category['id']}/activate")

    assert shown.status_code == 200
    assert shown.json()["is_active"] is True


async def test_deleting_a_category_in_use_is_refused_with_a_reason(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/product-categories", json={"name": "En uso"})).json()
    await client.post("/api/v1/products", json=_product_payload(category_id=category["id"]))

    response = await client.delete(f"/api/v1/product-categories/{category['id']}")

    assert response.status_code == 409
    message = response.json()["error"]["message"]
    assert "1 productos" in message
    assert "Ocúltala" in message


async def test_an_unused_category_can_be_deleted(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/product-categories", json={"name": "Sobrante"})).json()

    response = await client.delete(f"/api/v1/product-categories/{category['id']}")

    assert response.status_code == 204
    listed = [c["id"] for c in (await client.get("/api/v1/product-categories")).json()]
    assert category["id"] not in listed


async def test_cashier_cannot_hide_or_delete_a_category(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/product-categories", json={"name": "Protegida"})).json()

    await login(role_name="CASHIER")

    assert (
        await client.post(f"/api/v1/product-categories/{category['id']}/deactivate")
    ).status_code == 403
    assert (await client.delete(f"/api/v1/product-categories/{category['id']}")).status_code == 403


async def test_a_category_can_be_renamed_after_creation(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Se renombra en el sitio: mismo id, así que el producto que la tiene
    asignada la conserva y pasa a verse con el nombre nuevo."""
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/product-categories", json={"name": "Bevidas"})).json()
    product = (
        await client.post("/api/v1/products", json=_product_payload(category_id=category["id"]))
    ).json()

    response = await client.patch(
        f"/api/v1/product-categories/{category['id']}", json={"name": "Bebidas"}
    )

    assert response.status_code == 200
    assert response.json() == {**category, "name": "Bebidas"}
    updated = (await client.get(f"/api/v1/products/{product['id']}")).json()
    assert updated["category_id"] == category["id"]
    assert updated["category_name"] == "Bebidas"


async def test_renaming_a_category_onto_an_existing_name_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await client.post("/api/v1/product-categories", json={"name": "Bebidas"})
    other = (await client.post("/api/v1/product-categories", json={"name": "Lácteos"})).json()

    response = await client.patch(
        f"/api/v1/product-categories/{other['id']}", json={"name": "Bebidas"}
    )

    assert response.status_code == 409
    # Renombrarla a lo que ya se llama no es un choque consigo misma.
    same = await client.patch(f"/api/v1/product-categories/{other['id']}", json={"name": "Lácteos"})
    assert same.status_code == 200


async def test_products_can_be_searched_by_barcode(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """El código de barras es lo que está impreso en el producto; el SKU es
    una referencia interna que nadie se sabe de memoria."""
    await login(role_name="ADMIN")
    product = (await client.post("/api/v1/products", json=_product_payload())).json()
    await client.post(
        f"/api/v1/products/{product['id']}/packages",
        json={"name": "CAJA 6", "factor": "6", "barcode": "8412345678901"},
    )
    await client.post(
        "/api/v1/products",
        json=_product_payload(sku="WATER-1L", name="Agua 1L", base_barcode="777777"),
    )

    # El de un formato que no es el base cuenta igual: es el mismo producto.
    by_box = await client.get("/api/v1/products?search=8412345678901")
    assert [p["id"] for p in by_box.json()] == [product["id"]]

    by_base = await client.get("/api/v1/products?search=111111")
    assert [p["id"] for p in by_base.json()] == [product["id"]]

    # Y el nombre y el SKU siguen buscándose como antes.
    assert [p["id"] for p in (await client.get("/api/v1/products?search=leche")).json()] == [
        product["id"]
    ]
    assert (await client.get("/api/v1/products?search=000000")).json() == []


async def test_product_search_can_limit_autocomplete_results(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    for number in range(3):
        response = await client.post(
            "/api/v1/products",
            json=_product_payload(
                sku=f"WATER-{number}",
                name=f"Agua mineral {number}",
                base_barcode=f"800000{number}",
            ),
        )
        assert response.status_code == 201

    response = await client.get("/api/v1/products?search=agua&limit=2")

    assert response.status_code == 200
    assert len(response.json()) == 2
