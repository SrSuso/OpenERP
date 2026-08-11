"""El cierre de caja (la Z de totales).

Lo que importa: que cuadre lo que se ha cobrado, que el turno vaya de un
cierre al siguiente sin huecos ni solapes, y que no se pueda cerrar con
una venta a medias.
"""

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


async def _sell(client: AsyncClient, *, sku: str, price: str, method: str = "CASH") -> int:
    """Una venta cobrada entera, de un producto que se crea al vuelo."""
    warehouse_id, location_id = await _default_location(client)
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
        json={"payments": [{"method": method, "amount": price}]},
    )
    assert checkout.status_code == 200, checkout.text
    sale_id: int = sale["id"]
    return sale_id


async def test_a_close_adds_up_what_was_taken(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, _ = await _default_location(client)
    await _sell(client, sku="Z-1", price="10.00", method="CASH")
    await _sell(client, sku="Z-2", price="5.00", method="CARD")

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
    warehouse_id, _ = await _default_location(client)
    await _sell(client, sku="Z-3", price="10.00")
    first = (await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})).json()

    await _sell(client, sku="Z-4", price="7.00")
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
    warehouse_id, _ = await _default_location(client)
    sale_id = await _sell(client, sku="Z-5", price="10.00")
    closed = (await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})).json()

    sale = (await client.get(f"/api/v1/sales/{sale_id}")).json()
    line = sale["lines"][0]
    await client.post(
        f"/api/v1/sales/{sale_id}/returns",
        json={"lines": [{"sale_line_id": line["id"], "quantity_packages": "1"}]},
    )

    listed = (await client.get("/api/v1/z-reports")).json()
    assert next(z for z in listed if z["id"] == closed["id"]) == closed


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
    warehouse_id, _ = await _default_location(client)
    await _sell(client, sku="Z-6", price="4.00")

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
    warehouse_id, _ = await _default_location(client)

    await login(role_name="CASHIER")
    closed = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert closed.status_code == 201
