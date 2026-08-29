"""POS-facing categories (phase 10): till-button groups, independent from a
product's shelf category, plus assigning a product to one."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def _create_product(
    client: AsyncClient, sku: str = "POS-CAT-1", name: str = "Producto para categoría POS"
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/products",
        json={
            "sku": sku,
            "name": name,
            "base_unit_name": "UNIDAD",
            "cost": "1.00",
            "list_price": "2.00",
        },
    )
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def test_manager_can_create_and_list_pos_categories(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="MANAGER")

    response = await client.post(
        "/api/v1/pos-categories", json={"name": "Bebidas", "color": "#FF8800", "display_order": 1}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Bebidas"
    assert body["color"] == "#FF8800"
    assert body["display_order"] == 1
    assert body["is_active"] is True

    listed = (await client.get("/api/v1/pos-categories")).json()
    assert any(c["name"] == "Bebidas" for c in listed)


async def test_pos_categories_are_listed_by_display_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await client.post("/api/v1/pos-categories", json={"name": "Zzz-last", "display_order": 5})
    await client.post("/api/v1/pos-categories", json={"name": "Aaa-first", "display_order": 1})

    listed = (await client.get("/api/v1/pos-categories")).json()
    names = [c["name"] for c in listed]
    assert names.index("Aaa-first") < names.index("Zzz-last")


async def test_default_color_is_applied_when_not_given(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post("/api/v1/pos-categories", json={"name": "Sin color"})

    assert response.status_code == 201
    assert response.json()["color"] == "#64748b"


async def test_only_one_pos_category_can_be_default(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    first = (
        await client.post("/api/v1/pos-categories", json={"name": "Bebidas", "is_default": True})
    ).json()
    second = (await client.post("/api/v1/pos-categories", json={"name": "Panadería"})).json()

    updated = await client.patch(
        f"/api/v1/pos-categories/{second['id']}", json={"is_default": True}
    )
    assert updated.status_code == 200
    assert updated.json()["is_default"] is True

    listed = (await client.get("/api/v1/pos-categories")).json()
    assert [category["id"] for category in listed if category["is_default"]] == [second["id"]]
    assert first["is_default"] is True

    hidden = await client.post(f"/api/v1/pos-categories/{second['id']}/deactivate")
    assert hidden.status_code == 200
    assert hidden.json()["is_default"] is False


async def test_invalid_color_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/pos-categories", json={"name": "Color inválido", "color": "not-a-color"}
    )

    assert response.status_code == 422


async def test_duplicate_pos_category_name_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    payload = {"name": "Postres"}
    assert (await client.post("/api/v1/pos-categories", json=payload)).status_code == 201

    second = await client.post("/api/v1/pos-categories", json=payload)
    assert second.status_code == 409


async def test_update_pos_category_renames_and_recolors(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category_id = (await client.post("/api/v1/pos-categories", json={"name": "Original"})).json()[
        "id"
    ]

    response = await client.patch(
        f"/api/v1/pos-categories/{category_id}",
        json={"name": "Renombrada", "color": "#123456", "display_order": 9},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renombrada"
    assert body["color"] == "#123456"
    assert body["display_order"] == 9


async def test_deactivate_pos_category_hides_it_from_active_only_listing(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category_id = (await client.post("/api/v1/pos-categories", json={"name": "Temporal"})).json()[
        "id"
    ]

    response = await client.post(f"/api/v1/pos-categories/{category_id}/deactivate")
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    active_listing = (await client.get("/api/v1/pos-categories")).json()
    assert all(c["id"] != category_id for c in active_listing)

    full_listing = (
        await client.get("/api/v1/pos-categories", params={"active_only": False})
    ).json()
    assert any(c["id"] == category_id for c in full_listing)


async def test_assigning_a_product_to_a_pos_category_and_filtering_products_by_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category_id = (await client.post("/api/v1/pos-categories", json={"name": "Ofertas"})).json()[
        "id"
    ]
    product = await _create_product(client)

    update_response = await client.patch(
        f"/api/v1/products/{product['id']}",
        json={"pos_category_id": category_id, "pos_display_order": 3},
    )
    assert update_response.status_code == 200
    body = update_response.json()
    assert body["pos_category_id"] == category_id
    assert body["pos_category_name"] == "Ofertas"
    assert body["pos_display_order"] == 3

    filtered = (
        await client.get("/api/v1/products", params={"pos_category_id": category_id})
    ).json()
    assert [p["id"] for p in filtered] == [product["id"]]


async def test_pos_product_order_starts_at_one_and_sends_zero_to_the_end(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category_id = (await client.post("/api/v1/pos-categories", json={"name": "Orden"})).json()["id"]
    first = await _create_product(client, sku="POS-ORDER-1", name="Primero")
    second = await _create_product(client, sku="POS-ORDER-2", name="Segundo")
    last = await _create_product(client, sku="POS-ORDER-0", name="Al final")

    for product, order in ((first, 1), (second, 2), (last, 0)):
        response = await client.patch(
            f"/api/v1/products/{product['id']}",
            json={"pos_category_id": category_id, "pos_display_order": order},
        )
        assert response.status_code == 200

    filtered = (
        await client.get("/api/v1/products", params={"pos_category_id": category_id})
    ).json()
    assert [product["id"] for product in filtered] == [first["id"], second["id"], last["id"]]


async def test_assigning_a_product_to_a_nonexistent_pos_category_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="POS-CAT-2")

    response = await client.patch(
        f"/api/v1/products/{product['id']}", json={"pos_category_id": 999999}
    )

    assert response.status_code == 422


async def test_product_without_pos_category_has_null_fields(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="POS-CAT-3")

    assert product["pos_category_id"] is None
    assert product["pos_category_name"] is None
    assert product["pos_display_order"] == 1


async def test_cashier_can_read_but_not_manage_pos_categories(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/pos-categories")).status_code == 200
    assert (
        await client.post("/api/v1/pos-categories", json={"name": "No permitido"})
    ).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/pos-categories")

    assert response.status_code == 401


async def test_a_pos_category_can_be_hidden_and_shown_again(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Sin el camino de vuelta, esconder una por error obligaba a crear otra
    igual y reasignarle los productos a mano."""
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/pos-categories", json={"name": "Ofertas"})).json()

    hidden = await client.post(f"/api/v1/pos-categories/{category['id']}/deactivate")
    assert hidden.status_code == 200
    assert hidden.json()["is_active"] is False

    shown = await client.post(f"/api/v1/pos-categories/{category['id']}/activate")
    assert shown.status_code == 200
    assert shown.json()["is_active"] is True


async def test_colour_and_order_can_be_changed_after_creating_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un color mal elegido no puede obligar a crear otra categoría."""
    await login(role_name="ADMIN")
    category = (
        await client.post(
            "/api/v1/pos-categories",
            json={"name": "Fruta", "color": "#64748b", "display_order": 0},
        )
    ).json()

    updated = await client.patch(
        f"/api/v1/pos-categories/{category['id']}",
        json={"name": "Fruta y verdura", "color": "#22c55e", "display_order": 3},
    )

    assert updated.status_code == 200
    assert updated.json() == {
        **category,
        "name": "Fruta y verdura",
        "color": "#22c55e",
        "display_order": 3,
    }


async def test_a_pos_category_in_use_is_not_deleted(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/pos-categories", json={"name": "En uso"})).json()
    await client.post(
        "/api/v1/products",
        json={
            "name": "Tomate",
            "base_unit_name": "KG",
            "cost": "1.20",
            "list_price": "1.68",
            "pos_category_id": category["id"],
        },
    )

    refused = await client.delete(f"/api/v1/pos-categories/{category['id']}")

    assert refused.status_code == 409
    assert "1 productos" in refused.json()["error"]["message"]


async def test_an_unused_pos_category_can_be_deleted(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/pos-categories", json={"name": "Sobrante"})).json()

    assert (await client.delete(f"/api/v1/pos-categories/{category['id']}")).status_code == 204

    listed = (await client.get("/api/v1/pos-categories?active_only=false")).json()
    assert category["id"] not in [c["id"] for c in listed]
