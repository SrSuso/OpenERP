"""El cierre de caja (la Z de totales).

Lo que importa: que cuadre lo que se ha cobrado, que el turno vaya de un
cierre al siguiente sin huecos ni solapes, y que no se pueda cerrar con
una venta a medias.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient

_till_counter = 0


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    """Una caja recién estrenada para cada prueba.

    Una Z cuenta *todo* lo que haya en su almacén desde el cierre anterior,
    así que usar la tienda de siempre hacía que estas pruebas dependieran
    de lo que hubieran dejado otras — y alguna deja cosas a propósito, con
    su propia conexión (ver `committing_sessionmaker` en conftest). Con un
    almacén propio cada una cuenta sólo lo suyo, salga en el orden que
    salga.
    """
    global _till_counter
    _till_counter += 1
    warehouse = (
        await client.post("/api/v1/warehouses", json={"name": f"Caja Z {_till_counter}"})
    ).json()
    location = (
        await client.post(
            f"/api/v1/warehouses/{warehouse['id']}/locations", json={"name": "Mostrador"}
        )
    ).json()
    return warehouse["id"], location["id"]


async def _sell(
    client: AsyncClient,
    warehouse_id: int,
    location_id: int,
    *,
    sku: str,
    price: str,
    method: str = "CASH",
    tendered: str | None = None,
) -> int:
    """Una venta cobrada entera, de un producto que se crea al vuelo.

    `tendered` es lo que entrega el cliente: si es más que el precio, la
    diferencia vuelve como cambio y **no** se queda en el cajón.
    """
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": sku,
                "name": f"Producto {sku}",
                "base_unit_name": "UNIDAD",
                "cost": "1.00",
                "list_price": price,
            },
        )
    ).json()
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "1",
        },
    )
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()
    await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": next(p["id"] for p in product["packages"] if p["is_base"]),
            "quantity_packages": "1",
        },
    )
    checkout = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": method, "amount": tendered or price}]},
    )
    assert checkout.status_code == 200, checkout.text
    sale_id: int = sale["id"]
    return sale_id


async def test_a_close_adds_up_what_was_taken(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await _sell(client, warehouse_id, location_id, sku="Z-1", price="10.00", method="CASH")
    await _sell(client, warehouse_id, location_id, sku="Z-2", price="5.00", method="CARD")

    closed = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert closed.status_code == 201
    report = closed.json()
    assert report["number"] == 1
    assert report["sales_count"] == 2
    assert report["cash_total"] == "10.000000"
    assert report["card_total"] == "5.000000"
    assert report["other_total"] == "0.000000"
    # Primera Z de esta caja: no hay corte anterior, así que entra todo.
    assert report["covers_from"] is None


async def test_the_next_close_only_covers_what_came_after(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Encadenando por el cierre anterior no hay huecos ni solapes."""
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await _sell(client, warehouse_id, location_id, sku="Z-3", price="10.00")
    first = (await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})).json()

    await _sell(client, warehouse_id, location_id, sku="Z-4", price="7.00")
    second = (await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})).json()

    assert second["number"] == 2
    assert second["sales_count"] == 1
    assert second["cash_total"] == "7.000000"
    assert second["covers_from"] == first["closed_at"]


async def test_a_frozen_close_does_not_change_afterwards(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Es el papel con el que se cuadró el cajón esa noche: tiene que decir
    lo mismo dentro de un año."""
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    sale_id = await _sell(client, warehouse_id, location_id, sku="Z-5", price="10.00")
    closed = (await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})).json()

    sale = (await client.get(f"/api/v1/sales/{sale_id}")).json()
    line = sale["lines"][0]
    await client.post(
        f"/api/v1/sales/{sale_id}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": line["id"],
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "0",
                }
            ],
            "refund_method": "CASH",
        },
    )

    listed = (await client.get("/api/v1/z-reports")).json()
    assert next(z for z in listed if z["id"] == closed["id"]) == closed

    physical_only = await client.post(
        f"/api/v1/sales/{sale_id}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": line["id"],
                    "refund_quantity_packages": "0",
                    "stock_return_quantity_packages": "1",
                }
            ]
        },
    )
    assert physical_only.status_code == 201
    assert physical_only.json()["refund"] is None

    next_close = (
        await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})
    ).json()
    assert next_close["covers_from"] == closed["closed_at"]
    assert next_close["returns_count"] == 1
    assert next_close["returns_total"] == "10.000000"


async def test_the_till_cannot_be_closed_with_a_sale_in_progress(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un carrito con algo dentro se cobraría después del corte: quedaría
    fuera de esta Z y dentro de la siguiente, cuadrando mal las dos. Y el
    aviso dice cuál es: "hay una sin cobrar" a secas deja sin salida a
    quien está en el mostrador."""
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "Z-PENDING",
                "name": "Pan",
                "base_unit_name": "UNIDAD",
                "cost": "0.50",
                "list_price": "1.00",
            },
        )
    ).json()
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()
    await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": next(p["id"] for p in product["packages"] if p["is_base"]),
            "quantity_packages": "1",
        },
    )

    refused = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert refused.status_code == 409
    assert f"#{sale['id']}" in refused.json()["error"]["message"]


async def test_an_empty_cart_does_not_block_the_close(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """La caja abre un carrito vacío sola en cuanto se queda sin ninguno,
    así que contándolos no habría forma humana de cerrar el turno: se
    cancela el vacío y aparece otro. Y no hay nada que cuadrar en un
    carrito sin líneas."""
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await client.post(
        "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
    )

    closed = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert closed.status_code == 201


async def test_the_preview_says_what_would_be_closed(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await _sell(client, warehouse_id, location_id, sku="Z-6", price="4.00")

    preview = (
        await client.get("/api/v1/z-reports/preview", params={"warehouse_id": warehouse_id})
    ).json()

    assert preview["sales_count"] == 1
    assert preview["cash_total"] == "4.000000"
    assert preview["open_sales"] == []
    # Y no ha guardado nada: sigue sin haber ninguna Z.
    assert (await client.get("/api/v1/z-reports")).json() == []


async def test_a_cashier_can_close_their_own_till(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Cerrar la caja es parte de vender: si pidiera permisos de
    administración, nadie podría irse a su hora."""
    await login(role_name="ADMIN")
    warehouse_id, _location_id = await _default_location(client)

    await login(role_name="CASHIER")
    closed = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert closed.status_code == 201


async def test_a_z_period_survives_a_cashier_change(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Cerrar la sesión de un cajero no es un cierre de caja.

    La Z se delimita por almacén y por el corte anterior, no por quién tenga
    la cookie del TPV. Por eso una venta de Ana sigue en el mismo periodo
    cuando María entra después y decide hacer la Z.
    """
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await _sell(client, warehouse_id, location_id, sku="Z-CASHIER-CHANGE", price="9.00")

    signed_out = await client.post("/api/v1/auth/logout")
    assert signed_out.status_code == 204
    second_cashier = await login(role_name="CASHIER")

    closed = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert closed.status_code == 201
    report = closed.json()
    assert report["sales_count"] == 1
    assert report["gross_total"] == "9.000000"
    assert report["closed_by_user_id"] == second_cashier["id"]


async def test_the_change_given_back_is_not_counted_as_cash(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un billete de 20 por una compra de 12,40 deja 12,40 en el cajón, no
    20. Contar lo entregado descuadraría la Z justo por el importe del
    cambio, en el papel que sirve para contar el cajón."""
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    await _sell(client, warehouse_id, location_id, sku="Z-CHANGE", price="12.40", tendered="20.00")

    report = (await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})).json()

    assert report["cash_total"] == "12.400000"
    # Y lo cobrado cuadra con el desglose por forma de pago.
    assert report["gross_total"] == "12.400000"
