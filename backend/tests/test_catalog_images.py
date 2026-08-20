"""Fotos de productos y categorías del TPV.

Lo que importa aquí: que sólo se puedan colgar de un dueño conocido, que
cada tipo de dueño pida su propio permiso, y que reemplazar una foto suba
la versión (que es lo que hace que el navegador deje de enseñar la vieja).
"""

from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient

from app.auth.security import hash_password
from app.users.models import User

#: Un PNG de 1x1 de verdad — el endpoint devuelve estos mismos bytes.
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(PNG_1X1).decode()


async def _a_product(client: AsyncClient) -> int:
    response = await client.post(
        "/api/v1/products",
        json={
            "name": "Tomate",
            "base_unit_name": "KG",
            "cost": "1.20",
            "list_price": "1.68",
        },
    )
    assert response.status_code == 201
    product_id: int = response.json()["id"]
    return product_id


async def test_a_product_photo_is_stored_and_served_back(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _a_product(client)

    put = await client.put(f"/api/v1/images/product/{product_id}", json={"data_url": PNG_DATA_URL})

    assert put.status_code == 200
    assert put.json() == {"entity_id": product_id, "version": 1}

    got = await client.get(f"/api/v1/images/product/{product_id}")
    assert got.status_code == 200
    assert got.headers["content-type"] == "image/png"
    assert got.content == PNG_1X1

    # El índice es lo que mira el TPV para pintar `<img>` sólo donde hay algo.
    index = (await client.get("/api/v1/images/product")).json()
    assert index == {str(product_id): 1}


async def test_replacing_a_photo_bumps_its_version(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """La versión va en la URL: si no subiera, el navegador seguiría
    enseñando la foto anterior."""
    await login(role_name="ADMIN")
    product_id = await _a_product(client)
    await client.put(f"/api/v1/images/product/{product_id}", json={"data_url": PNG_DATA_URL})

    again = await client.put(
        f"/api/v1/images/product/{product_id}", json={"data_url": PNG_DATA_URL}
    )

    assert again.json()["version"] == 2


async def test_a_photo_can_be_removed(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _a_product(client)
    await client.put(f"/api/v1/images/product/{product_id}", json={"data_url": PNG_DATA_URL})

    deleted = await client.delete(f"/api/v1/images/product/{product_id}")

    assert deleted.status_code == 204
    assert (await client.get(f"/api/v1/images/product/{product_id}")).status_code == 404
    assert (await client.get("/api/v1/images/product")).json() == {}


async def test_only_pos_categories_can_have_a_photo(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/product-categories", json={"name": "Fruta"})).json()
    pos_category = (await client.post("/api/v1/pos-categories", json={"name": "Ofertas"})).json()

    # Las categorías generales controlan stock, unidad, impuestos y precios;
    # no son botones visuales de caja. La foto pertenece sólo a la categoría
    # POS, que es la que se presenta en el TPV.
    assert (
        await client.put(
            f"/api/v1/images/product_category/{category['id']}", json={"data_url": PNG_DATA_URL}
        )
    ).status_code == 404
    assert (
        await client.put(
            f"/api/v1/images/pos_category/{pos_category['id']}", json={"data_url": PNG_DATA_URL}
        )
    ).status_code == 200

    assert (await client.get("/api/v1/images/pos_category")).json() == {str(pos_category["id"]): 1}


async def test_an_unknown_owner_is_not_a_place_to_store_things(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    assert (
        await client.put("/api/v1/images/user/1", json={"data_url": PNG_DATA_URL})
    ).status_code == 404
    assert (await client.get("/api/v1/images/user")).status_code == 404


async def test_a_photo_needs_an_owner_that_exists(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.put("/api/v1/images/product/999999", json={"data_url": PNG_DATA_URL})

    assert response.status_code == 404


async def test_only_an_image_of_a_known_format_is_accepted(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un SVG es un documento con scripts dentro, no una foto."""
    await login(role_name="ADMIN")
    product_id = await _a_product(client)

    svg = "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode()
    assert (
        await client.put(f"/api/v1/images/product/{product_id}", json={"data_url": svg})
    ).status_code == 422

    not_a_data_url = await client.put(
        f"/api/v1/images/product/{product_id}", json={"data_url": "https://example.com/foto.png"}
    )
    assert not_a_data_url.status_code == 422


async def test_a_cashier_can_see_photos_but_not_change_them(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """El TPV las enseña, así que verlas va con `product.read`; ponerlas
    pide el permiso de gestión del dueño (regla 11)."""
    await login(role_name="ADMIN")
    product_id = await _a_product(client)
    await client.put(f"/api/v1/images/product/{product_id}", json={"data_url": PNG_DATA_URL})

    await login(role_name="CASHIER")

    assert (await client.get(f"/api/v1/images/product/{product_id}")).status_code == 200
    assert (
        await client.put(f"/api/v1/images/product/{product_id}", json={"data_url": PNG_DATA_URL})
    ).status_code == 403
    assert (await client.delete(f"/api/v1/images/product/{product_id}")).status_code == 403


async def test_pos_cookie_can_serve_an_image_without_an_admin_session(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
) -> None:
    """El navegador no puede añadir la cabecera que selecciona sesión POS a
    un ``<img>``; la URL de imagen del TPV usa su parámetro limitado a esta
    ruta para que se elija la cookie correcta."""
    await login(role_name="ADMIN")
    product_id = await _a_product(client)
    await client.put(f"/api/v1/images/product/{product_id}", json={"data_url": PNG_DATA_URL})

    cashier = await make_user(email="pos-images@example.com", role_name="CASHIER")
    cashier.pos_username = "caja-imagenes"
    cashier.pos_pin_hash = hash_password("1234")
    cashier.pos_access_enabled = True
    assert (
        await client.post(
            "/api/v1/auth/pos/login", json={"username": "caja-imagenes", "pin": "1234"}
        )
    ).status_code == 200
    pos_cookie = client.cookies.get("openerp_pos_session")
    assert pos_cookie is not None

    # Simula la petición autónoma del navegador: sólo llega la cookie POS,
    # sin la cabecera que sí puede añadir fetch().
    image_headers = {"Cookie": f"openerp_pos_session={pos_cookie}"}
    assert (
        await client.get(f"/api/v1/images/product/{product_id}", headers=image_headers)
    ).status_code == 401
    served = await client.get(
        f"/api/v1/images/product/{product_id}?v=1&session_surface=pos",
        headers=image_headers,
    )
    assert served.status_code == 200
    assert served.content == PNG_1X1
