"""Returns (phase 14): refund, restock, or both — independently per line
(rule 9), only against a completed sale."""

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
    client: AsyncClient, sku: str = "RETURN-TEST-1", **overrides: Any
) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": "Producto de devolución",
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


async def _stock(
    client: AsyncClient,
    *,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    quantity: str,
) -> None:
    response = await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": quantity,
            "unit_cost": "1.00",
        },
    )
    assert response.status_code == 201


async def _completed_sale(
    client: AsyncClient, *, product: dict[str, Any], quantity: str = "3"
) -> dict[str, Any]:
    """Open a sale, add one line for ``product``, check out with exact
    cash. Requires stock already seeded for the product."""
    warehouse_id, location_id = await _default_location(client)
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
    total = added["total"]
    completed = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": total}]},
    )
    assert completed.status_code == 200
    result: dict[str, Any] = completed.json()
    return result


async def test_economic_only_return_refunds_without_touching_stock(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(
        client, sku="RETURN-ECONOMIC", list_price="10.00", tax_rate="21"
    )
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale = await _completed_sale(client, product=product, quantity="3")
    sale_line_id = sale["lines"][0]["id"]
    balance_before = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()[0]["quantity"]

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "0",
                }
            ],
            "refund_method": "CASH",
        },
    )

    assert response.status_code == 201
    body = response.json()
    line = body["lines"][0]
    assert line["refund_quantity_packages"] == "1.000000"
    assert line["stock_return_quantity_packages"] == "0.000000"
    # Se devuelve exactamente lo que se cobró: el PVP ya lleva el IVA, así
    # que 1 * 10.00 = 10, no 10 + 21%.
    assert line["refund_amount"] == "10.000000"
    assert line["stock_movement_id"] is None
    assert body["total_refund"] == "10.000000"

    balance_after = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()[0]["quantity"]
    assert balance_after == balance_before

    refreshed_sale = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert refreshed_sale["lines"][0]["quantity_refunded"] == "1.000000"
    assert refreshed_sale["lines"][0]["quantity_physically_returned"] == "0.000000"


async def test_physical_only_return_restocks_without_refunding(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-PHYSICAL")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale = await _completed_sale(client, product=product, quantity="3")
    sale_line_id = sale["lines"][0]["id"]

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "0",
                    "stock_return_quantity_packages": "2",
                }
            ]
        },
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["refund_amount"] == "0.000000"
    assert line["stock_movement_id"] is not None
    assert response.json()["refund"] is None

    balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    # 10 stocked - 3 sold + 2 returned = 9.
    assert balances[0]["quantity"] == "9.000000"


async def test_full_return_refunds_and_restocks(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-BOTH", list_price="5.00", tax_rate="0")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale = await _completed_sale(client, product=product, quantity="2")
    sale_line_id = sale["lines"][0]["id"]

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "2",
                    "stock_return_quantity_packages": "2",
                }
            ],
            "refund_method": "CASH",
        },
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["refund_quantity_packages"] == "2.000000"
    assert line["stock_return_quantity_packages"] == "2.000000"
    assert line["refund_amount"] == "10.000000"

    balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    assert balances[0]["quantity"] == "10.000000"  # 10 - 2 + 2


async def test_returning_more_than_sold_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-EXCESS")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale = await _completed_sale(client, product=product, quantity="2")
    sale_line_id = sale["lines"][0]["id"]

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "3",
                    "stock_return_quantity_packages": "3",
                }
            ],
            "refund_method": "CASH",
        },
    )

    assert response.status_code == 422


async def test_returning_cumulatively_over_the_limit_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-CUMULATIVE")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale = await _completed_sale(client, product=product, quantity="3")
    sale_line_id = sale["lines"][0]["id"]
    first = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "2",
                    "stock_return_quantity_packages": "2",
                }
            ],
            "refund_method": "CASH",
        },
    )
    assert first.status_code == 201

    second = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "2",
                    "stock_return_quantity_packages": "2",
                }
            ],
            "refund_method": "CASH",
        },
    )

    # The payload was valid against the sold quantity, but now collides
    # with a previous return: this is stale aggregate state, not malformed
    # input.
    assert second.status_code == 409


async def test_return_line_needs_an_economic_or_physical_quantity(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-NEITHER")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale = await _completed_sale(client, product=product, quantity="1")
    sale_line_id = sale["lines"][0]["id"]

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "0",
                    "stock_return_quantity_packages": "0",
                }
            ]
        },
    )

    assert response.status_code == 422


async def test_cannot_return_against_a_draft_sale(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, location_id = await _default_location(client)
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
        )
    ).json()

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": 1,
                    "refund_quantity_packages": "0",
                    "stock_return_quantity_packages": "1",
                }
            ]
        },
    )

    assert response.status_code == 422


async def test_return_line_must_belong_to_the_sale(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-WRONGLINE")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale_a = await _completed_sale(client, product=product, quantity="1")
    sale_b = await _completed_sale(client, product=product, quantity="1")
    sale_b_line_id = sale_b["lines"][0]["id"]

    response = await client.post(
        f"/api/v1/sales/{sale_a['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_b_line_id,
                    "refund_quantity_packages": "0",
                    "stock_return_quantity_packages": "1",
                }
            ]
        },
    )

    assert response.status_code == 422


async def test_lot_tracked_product_requires_a_lot_number_to_restock(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "RETURN-LOT-NOLOT",
                "name": "Producto con lote",
                "base_unit_name": "UNIDAD",
                "cost": "1.00",
                "list_price": "1.00",
                "tax_rate": "0",
                "track_lots": True,
            },
        )
    ).json()
    warehouse_id, location_id = await _default_location(client)
    lot_id = (
        await client.post(
            "/api/v1/lots", json={"product_id": product["id"], "lot_number": "LOTE-ORIGINAL"}
        )
    ).json()["id"]
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "1.00",
            "lot_id": lot_id,
        },
    )
    sale = await _completed_sale(client, product=product, quantity="1")
    sale_line_id = sale["lines"][0]["id"]

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "0",
                    "stock_return_quantity_packages": "1",
                }
            ]
        },
    )

    assert response.status_code == 422


async def test_untracked_product_rejects_a_lot_number_without_partial_return(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-UNTRACKED-WITH-LOT")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale = await _completed_sale(client, product=product, quantity="1")
    sale_line_id = sale["lines"][0]["id"]

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "0",
                    "stock_return_quantity_packages": "1",
                    "lot_number": "FORBIDDEN-LOT",
                }
            ]
        },
    )

    assert response.status_code == 422
    assert (await client.get("/api/v1/returns", params={"sale_id": sale["id"]})).json() == []
    refreshed_sale = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert refreshed_sale["lines"][0]["quantity_refunded"] == "0.000000"
    assert refreshed_sale["lines"][0]["quantity_physically_returned"] == "0.000000"
    balances = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()
    assert balances[0]["quantity"] == "9.000000"


async def test_lot_tracked_product_restocks_into_the_given_lot(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "RETURN-LOT-OK",
                "name": "Producto con lote",
                "base_unit_name": "UNIDAD",
                "cost": "1.00",
                "list_price": "1.00",
                "tax_rate": "0",
                "track_lots": True,
            },
        )
    ).json()
    warehouse_id, location_id = await _default_location(client)
    lot_id = (
        await client.post(
            "/api/v1/lots", json={"product_id": product["id"], "lot_number": "LOTE-ORIGINAL"}
        )
    ).json()["id"]
    await client.post(
        "/api/v1/stock-movements/adjustments",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "movement_type": "ADJUSTMENT",
            "quantity": "10",
            "unit_cost": "1.00",
            "lot_id": lot_id,
        },
    )
    sale = await _completed_sale(client, product=product, quantity="1")
    sale_line_id = sale["lines"][0]["id"]

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "1",
                    "lot_number": "LOTE-DEVUELTO",
                }
            ],
            "refund_method": "CASH",
        },
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["lot_number"] == "LOTE-DEVUELTO"
    assert line["lot_id"] != lot_id

    balances = {
        b["lot_id"]: b["quantity"]
        for b in (
            await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
        ).json()
    }
    assert balances[line["lot_id"]] == "1.000000"


async def test_cashier_cannot_process_or_read_returns(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/returns")).status_code == 403
    assert (
        await client.post(
            "/api/v1/sales/1/returns",
            json={
                "lines": [
                    {
                        "sale_line_id": 1,
                        "refund_quantity_packages": "0",
                        "stock_return_quantity_packages": "1",
                    }
                ]
            },
        )
    ).status_code == 403


async def test_admin_and_manager_can_process_returns(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-MANAGER")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale = await _completed_sale(client, product=product, quantity="1")
    sale_line_id = sale["lines"][0]["id"]

    await login(role_name="MANAGER")
    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale_line_id,
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "1",
                }
            ],
            "refund_method": "CASH",
        },
    )

    assert response.status_code == 201


async def test_list_and_get_return(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-LISTGET")
    warehouse_id, location_id = await _default_location(client)
    await _stock(
        client,
        product_id=product["id"],
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity="10",
    )
    sale = await _completed_sale(client, product=product, quantity="1")
    sale_line_id = sale["lines"][0]["id"]
    created = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/returns",
            json={
                "lines": [
                    {
                        "sale_line_id": sale_line_id,
                        "refund_quantity_packages": "1",
                        "stock_return_quantity_packages": "1",
                    }
                ],
                "refund_method": "CASH",
            },
        )
    ).json()

    by_sale = (await client.get(f"/api/v1/sales/{sale['id']}/returns")).json()
    assert any(r["id"] == created["id"] for r in by_sale)

    filtered = (await client.get("/api/v1/returns", params={"sale_id": sale["id"]})).json()
    assert any(r["id"] == created["id"] for r in filtered)

    fetched = await client.get(f"/api/v1/returns/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == created["id"]


async def test_refund_with_prices_include_tax_matches_what_was_actually_charged(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """``PricingSettings.prices_include_tax`` (app.pricing.models): the
    refund for one unit of a 12.10€ tax-included product is exactly
    12.10€ — not 12.10 plus tax on top, which is what the historical
    (``False``) behaviour would have refunded."""
    await login(role_name="ADMIN")
    default_formula = (await client.get("/api/v1/pricing/settings")).json()["formula"]
    assert (
        await client.put(
            "/api/v1/pricing/settings",
            json={"formula": default_formula, "prices_include_tax": True},
        )
    ).status_code == 200
    try:
        # Created *after* flipping the setting — see the identical caveat
        # in tests/test_checkout.py's own version of this test.
        product = await _create_product(
            client, sku="RETURN-TAX-INCL", list_price="12.10", tax_rate="21"
        )
        warehouse_id, location_id = await _default_location(client)
        await _stock(
            client,
            product_id=product["id"],
            warehouse_id=warehouse_id,
            location_id=location_id,
            quantity="10",
        )
        sale = await _completed_sale(client, product=product, quantity="1")
        sale_line_id = sale["lines"][0]["id"]

        response = await client.post(
            f"/api/v1/sales/{sale['id']}/returns",
            json={
                "lines": [
                    {
                        "sale_line_id": sale_line_id,
                        "refund_quantity_packages": "1",
                        "stock_return_quantity_packages": "0",
                    }
                ],
                "refund_method": "CASH",
            },
        )

        assert response.status_code == 201
        assert response.json()["lines"][0]["refund_amount"] == "12.100000"
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
    response = await client.get("/api/v1/returns")

    assert response.status_code == 401


async def test_returning_a_product_without_stock_control_creates_no_stock(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Las dos mitades tienen que ser simétricas. Vender no descuenta nada
    de un producto sin control de existencias (esa es toda la gracia del
    stock infinito), así que devolver tampoco puede sumar: si sumara,
    aparecería stock salido de la nada justo en los productos que no
    deberían tener ninguno, y el inventario del resto dejaría de ser
    creíble."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="RETURN-NO-STOCK")
    updated = await client.patch(f"/api/v1/products/{product['id']}", json={"tracks_stock": False})
    assert updated.json()["effective_tracks_stock"] is False

    # Se vende sin tener nada en el almacén: la caja no se planta.
    sale = await _completed_sale(client, product=product, quantity="3")
    assert (await client.get(f"/api/v1/stock-balance?product_id={product['id']}")).json() == []

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "lines": [
                {
                    "sale_line_id": sale["lines"][0]["id"],
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "1",
                }
            ],
            "refund_method": "CASH",
        },
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    # La devolución se registra como física —la mercancía vuelve al
    # montón— pero sin movimiento de almacén detrás.
    assert line["stock_return_quantity_packages"] == "1.000000"
    assert line["stock_movement_id"] is None
    assert (await client.get(f"/api/v1/stock-balance?product_id={product['id']}")).json() == []
