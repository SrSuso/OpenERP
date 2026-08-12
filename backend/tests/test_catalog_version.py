"""La huella del catálogo: lo que la caja pregunta cada pocos segundos
para saber si tiene que volver a pedir precios y botones.

La caja vive en otro equipo y nadie la recarga, así que lo que importa es
que cualquier cambio hecho en el panel la mueva — y que no moverse
signifique de verdad que no hay nada nuevo.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog.models import ProductCategory
from app.catalog.version import catalog_version


async def _version(client: AsyncClient) -> str:
    response = await client.get("/api/v1/catalog-version")
    assert response.status_code == 200
    result: str = response.json()["version"]
    return result


async def _create_product(client: AsyncClient, name: str) -> int:
    response = await client.post(
        "/api/v1/products",
        json={
            "name": name,
            "base_unit_name": "UNIT",
            "cost": "1",
            "list_price": "2",
            "min_stock": "0",
        },
    )
    assert response.status_code == 201
    result: int = response.json()["id"]
    return result


async def test_it_does_not_move_on_its_own(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Si cambiara sola, la caja se pasaría el día recargando el catálogo
    entero para nada."""
    await login(role_name="ADMIN")

    assert await _version(client) == await _version(client)


async def test_a_new_product_moves_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    before = await _version(client)

    await _create_product(client, "Agua 1L")

    assert await _version(client) != before


async def test_editing_a_row_moves_it_even_without_creating_or_deleting_any(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Cambiar un precio no crea ni borra nada: lo único que se mueve es
    `updated_at`, que lo mantiene el ORM al emitir el UPDATE.

    Va con sesiones que confirman de verdad, y no con el cliente HTTP de
    los demás casos, porque `now()` en Postgres es la hora en que empezó la
    transacción: dentro de una sola —que es como corre una prueba normal
    aquí— todas las escrituras llevarían la misma marca y esto no probaría
    nada. Se limpia lo suyo al terminar, que estas filas sí quedan
    escritas."""
    async with committing_sessionmaker() as session:
        session.add(ProductCategory(name="ZZ-VERSION"))
        await session.commit()

    try:
        async with committing_sessionmaker() as session:
            before = await catalog_version(session)

        async with committing_sessionmaker() as session:
            category = (
                await session.execute(
                    select(ProductCategory).where(ProductCategory.name == "ZZ-VERSION")
                )
            ).scalar_one()
            category.margin_rate = Decimal("15")
            await session.commit()

        async with committing_sessionmaker() as session:
            assert await catalog_version(session) != before
    finally:
        async with committing_sessionmaker() as session:
            leftover = (
                await session.execute(
                    select(ProductCategory).where(ProductCategory.name == "ZZ-VERSION")
                )
            ).scalar_one_or_none()
            if leftover is not None:
                await session.delete(leftover)
                await session.commit()


async def test_a_new_till_button_moves_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    before = await _version(client)

    response = await client.post(
        "/api/v1/pos-categories", json={"name": "Ofertas", "color": "#64748b", "display_order": 0}
    )
    assert response.status_code == 201

    assert await _version(client) != before


async def test_a_shop_setting_moves_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Los colores de los botones, el nombre de la tienda, si el ticket
    sale solo al cobrar: la caja los lee y tiene que enterarse igual."""
    await login(role_name="ADMIN")
    before = await _version(client)

    response = await client.put(
        "/api/v1/settings/options", json={"values": {"app.display_name": "La Tienda"}}
    )
    assert response.status_code == 200

    assert await _version(client) != before


async def test_deleting_something_moves_it_too(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un borrado no deja ninguna fecha nueva detrás: si sólo se mirara
    `max(updated_at)`, la caja seguiría enseñando lo que ya no existe."""
    await login(role_name="ADMIN")
    category_id = (
        await client.post("/api/v1/product-categories", json={"name": "Temporal"})
    ).json()["id"]
    before = await _version(client)

    response = await client.delete(f"/api/v1/product-categories/{category_id}")
    assert response.status_code == 204

    assert await _version(client) != before


async def test_a_cashier_may_ask(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Quien cobra no tiene `product.read` y la caja la pregunta cada pocos
    segundos: si pidiera ese permiso, no serviría para nada."""
    await login(role_name="CASHIER")

    response = await client.get("/api/v1/catalog-version")

    assert response.status_code == 200


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/catalog-version")

    assert response.status_code == 401
