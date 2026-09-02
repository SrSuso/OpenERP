"""Sales (phase 11): building a cart (open a sale, add/remove lines, cancel
it). No stock is ever touched here — that, and reaching ``COMPLETED``, is
exclusively phase 13's job once payments exist."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sales.models import Sale
from app.sales.service import payable


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(w for w in warehouses if w["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(loc for loc in locations if loc["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def _create_product(
    client: AsyncClient, sku: str = "SALE-TEST-1", **overrides: Any
) -> dict[str, Any]:
    payload = {
        "sku": sku,
        "name": "Producto de venta",
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


_sku_counter = 0


def _next_sku() -> int:
    """Un SKU distinto por prueba: el catálogo es único por SKU y estas
    pruebas crean su propio producto."""
    global _sku_counter
    _sku_counter += 1
    return _sku_counter


async def _open_sale(client: AsyncClient) -> dict[str, Any]:
    warehouse_id, location_id = await _default_location(client)
    response = await client.post(
        "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": location_id}
    )
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def test_cashier_can_open_a_sale_and_add_a_line(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)
    assert sale["status"] == "DRAFT"
    assert sale["lines"] == []

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "3"},
    )

    assert response.status_code == 201
    body = response.json()
    line = body["lines"][0]
    assert line["quantity_packages"] == "3.000000"
    assert line["quantity_base"] == "3.000000"
    assert line["unit_price"] == "10.000000"
    # El PVP ya lleva el IVA (fórmula de fábrica), así que se cobra la
    # etiqueta y el impuesto se extrae de dentro: 3 * 10 = 30 cobrados, de
    # los cuales 30 - 30/1,21 = 5,21 son IVA.
    assert line["subtotal"] == "30.000000"
    assert line["tax_amount"] == "5.206612"
    assert line["total"] == "30.000000"
    assert body["total"] == "30.000000"


async def test_cold_drink_option_uses_the_configured_amount_per_unit(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    configured = await client.put(
        "/api/v1/settings/options",
        json={"values": {"pos.cold_drink_surcharge_amount": "0.20"}},
    )
    assert configured.status_code == 200
    product = await _create_product(client, sku="SALE-COLD-DRINK")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    cold = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "2",
            "cold_drink": True,
        },
    )

    assert cold.status_code == 201
    cold_line = cold.json()["lines"][0]
    assert cold_line["cold_drink_surcharge"] == "0.200000"
    assert cold_line["total"] == "20.400000"

    regular = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )

    assert regular.status_code == 201
    lines = regular.json()["lines"]
    assert len(lines) == 2
    assert {line["cold_drink_surcharge"] for line in lines} == {"0.000000", "0.200000"}


async def test_open_price_pos_product_uses_the_entered_final_total(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(
        client,
        sku="SALE-OPEN-PRICE",
        name="Charcutería",
        list_price="0",
        tax_rate="21",
        is_open_price=True,
    )
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "1",
            "open_price_total": "12.50",
        },
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["product_name"] == "Charcutería"
    assert line["total"] == "12.500000"
    assert line["unit_price"] == "12.500000"


async def test_open_price_keeps_the_entered_total_when_catalogue_prices_are_net(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    pricing = (await client.get("/api/v1/pricing/settings")).json()
    assert (
        await client.put(
            "/api/v1/pricing/settings",
            json={"formula": pricing["formula"], "prices_include_tax": False},
        )
    ).status_code == 200
    product = await _create_product(
        client,
        sku="SALE-OPEN-PRICE-NET",
        list_price="0",
        tax_rate="21",
        is_open_price=True,
    )
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "1",
            "open_price_total": "12.50",
        },
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["unit_price"] == "10.330579"
    assert payable(Decimal(line["total"])) == Decimal("12.500000")


async def test_open_price_cannot_be_forged_for_an_ordinary_product(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-NO-OPEN-PRICE")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "1",
            "open_price_total": "0.01",
        },
    )

    assert response.status_code == 422


async def test_open_price_product_requires_its_entered_total(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-OPEN-PRICE-REQUIRED", is_open_price=True)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )

    assert response.status_code == 422


async def test_line_price_is_a_snapshot_and_ignores_later_price_changes(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-SNAP", list_price="10.00")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    sale = await _open_sale(client)
    await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )

    # Change the price after the line was rung up (rule 7).
    await client.put(
        f"/api/v1/products/{product['id']}/pricing/manual-price", json={"list_price": "999.00"}
    )

    # El PVP Final es el que queda congelado para las líneas nuevas; la
    # línea anterior mantiene su snapshot de 10 €, como debe ser.
    new_sale = await _open_sale(client)
    new_line = await client.post(
        f"/api/v1/sales/{new_sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )
    assert new_line.status_code == 201
    assert new_line.json()["lines"][0]["unit_price"] == "999.000000"

    refreshed = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert refreshed["lines"][0]["unit_price"] == "10.000000"


async def test_selling_a_box_converts_to_base_units(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-BOX", list_price="1.00")
    box_id = (
        await client.post(
            f"/api/v1/products/{product['id']}/packages", json={"name": "CAJA 6", "factor": "6"}
        )
    ).json()["packages"][-1]["id"]
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": box_id, "quantity_packages": "2"},
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["quantity_packages"] == "2.000000"
    assert line["quantity_base"] == "12.000000"


async def test_discount_rate_is_applied_before_tax(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(
        client, sku="SALE-TEST-DISC", list_price="100.00", tax_rate="10"
    )
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "1",
            "discount_rate": "10",
        },
    )

    line = response.json()["lines"][0]
    # El descuento se aplica antes que nada: subtotal 100, descuento 10% ->
    # 10, quedan 90 a cobrar. Como el PVP ya lleva el IVA dentro, esos 90
    # son el total, y el 10% de impuesto se extrae: 90 - 90/1,10 = 8,18.
    assert line["discount_amount"] == "10.000000"
    assert line["tax_amount"] == "8.181818"
    assert line["total"] == "90.000000"


async def test_add_line_by_barcode(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-BARCODE", base_barcode="8412345000019")
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines/by-barcode",
        json={"barcode": "8412345000019", "quantity_packages": "2"},
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["product_id"] == product["id"]
    assert line["package_id"] == product["packages"][0]["id"]
    assert line["package_name"] == "UNIDAD"
    assert line["package_factor"] == "1.000000"
    assert line["quantity_packages"] == "2.000000"
    assert line["quantity_base"] == "2.000000"
    assert line["unit_price"] == "10.000000"
    assert line["package_price"] == "10.000000"


async def test_scanning_a_box_barcode_twice_keeps_its_package_and_factor(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(
        client,
        sku="SALE-TEST-BOX-BARCODE",
        base_barcode="8412345000026",
        list_price="1.20",
        tax_rate="0",
    )
    package_response = await client.post(
        f"/api/v1/products/{product['id']}/packages",
        json={"name": "CAJA 6", "factor": "6", "barcode": "8412345000064"},
    )
    box = next(package for package in package_response.json()["packages"] if not package["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    for _ in range(2):
        response = await client.post(
            f"/api/v1/sales/{sale['id']}/lines/by-barcode",
            json={"barcode": "8412345000064"},
        )
        assert response.status_code == 201

    lines = response.json()["lines"]
    assert len(lines) == 1
    line = lines[0]
    assert line["package_id"] == box["id"]
    assert line["package_name"] == "CAJA 6"
    assert line["package_factor"] == "6.000000"
    assert line["quantity_packages"] == "2.000000"
    assert line["quantity_base"] == "12.000000"
    assert line["unit_price"] == "1.200000"
    assert line["package_price"] == "7.200000"
    assert line["total"] == "14.400000"


async def test_package_own_price_is_used_by_touch_and_barcode(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(
        client,
        sku="SALE-TEST-PACKAGE-OWN-PRICE",
        base_barcode="8412345000095",
        list_price="1.20",
        tax_rate="0",
    )
    package_response = await client.post(
        f"/api/v1/products/{product['id']}/packages",
        json={
            "name": "CAJA 6",
            "factor": "6",
            "barcode": "8412345000096",
            "price_override": "5.50",
        },
    )
    box = next(package for package in package_response.json()["packages"] if not package["is_base"])

    await login(role_name="CASHIER")
    touch_sale = await _open_sale(client)
    touch = await client.post(
        f"/api/v1/sales/{touch_sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": box["id"],
            "quantity_packages": "1",
        },
    )
    assert touch.status_code == 201
    touch_line = touch.json()["lines"][0]
    assert touch_line["unit_price"] == "0.916667"
    assert touch_line["package_price"] == "5.500000"
    assert touch_line["total"] == "5.500000"

    barcode_sale = await _open_sale(client)
    scanned = await client.post(
        f"/api/v1/sales/{barcode_sale['id']}/lines/by-barcode",
        json={"barcode": "8412345000096"},
    )
    assert scanned.status_code == 201
    barcode_line = scanned.json()["lines"][0]
    assert barcode_line["unit_price"] == "0.916667"
    assert barcode_line["package_price"] == "5.500000"
    assert barcode_line["total"] == "5.500000"


async def test_scanning_unit_and_box_barcodes_keeps_two_presentations(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(
        client,
        sku="SALE-TEST-MIXED-BARCODES",
        base_barcode="8412345000033",
        list_price="1.20",
        tax_rate="0",
    )
    package_response = await client.post(
        f"/api/v1/products/{product['id']}/packages",
        json={"name": "CAJA 6", "factor": "6", "barcode": "8412345000071"},
    )
    base = next(package for package in product["packages"] if package["is_base"])
    box = next(package for package in package_response.json()["packages"] if not package["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    for barcode in ("8412345000033", "8412345000071"):
        response = await client.post(
            f"/api/v1/sales/{sale['id']}/lines/by-barcode", json={"barcode": barcode}
        )
        assert response.status_code == 201

    lines = {line["package_id"]: line for line in response.json()["lines"]}
    assert set(lines) == {base["id"], box["id"]}
    assert lines[base["id"]]["quantity_base"] == "1.000000"
    assert lines[box["id"]]["quantity_base"] == "6.000000"


async def test_unknown_barcode_leaves_the_draft_sale_unchanged(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines/by-barcode",
        json={"barcode": "UNKNOWN-A4"},
    )

    assert response.status_code == 404
    reread = await client.get(f"/api/v1/sales/{sale['id']}")
    assert reread.status_code == 200
    assert reread.json()["lines"] == []
    assert Decimal(reread.json()["total"]) == Decimal(0)


async def test_removing_a_line_recomputes_the_total(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-REMOVE")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)
    added = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
        )
    ).json()
    line_id = added["lines"][0]["id"]

    response = await client.delete(f"/api/v1/sales/{sale['id']}/lines/{line_id}")

    assert response.status_code == 200
    assert response.json()["lines"] == []
    assert Decimal(response.json()["total"]) == Decimal(0)


async def test_cannot_sell_a_deactivated_product(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-INACTIVE")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await client.post(f"/api/v1/products/{product['id']}/deactivate")
    sale = await _open_sale(client)

    response = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )

    assert response.status_code == 422


async def test_cancelling_a_cart_deletes_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un carrito cancelado desaparece: no ensucia la lista de ventas ni se
    lleva un número de ticket por delante. Puede borrarse porque no ha
    tocado nada — el stock y el cobro pasan al cobrar."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-CANCEL")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    cancel_response = await client.post(f"/api/v1/sales/{sale['id']}/cancel")
    assert cancel_response.status_code == 204

    assert (await client.get(f"/api/v1/sales/{sale['id']}")).status_code == 404
    add_after_cancel = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
    )
    assert add_after_cancel.status_code == 404
    assert (await client.post(f"/api/v1/sales/{sale['id']}/cancel")).status_code == 404


async def test_the_printed_number_skips_the_carts_that_were_never_charged(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """El número del ticket se asigna al cobrar, no al abrir el carrito:
    entre dos ventas seguidas no puede aparecer un hueco porque alguien
    haya abierto y cancelado uno por el medio."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="SALE-TEST-NUMBERING", list_price="1.00")
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    warehouse_id, location_id = await _default_location(client)
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

    async def charge() -> int:
        sale = await _open_sale(client)
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
        )
        done = await client.post(
            f"/api/v1/sales/{sale['id']}/checkout",
            json={"payments": [{"method": "CASH", "amount": "1.00"}]},
        )
        assert done.status_code == 200
        number: int = done.json()["number"]
        return number

    first = await charge()
    # Un carrito abierto y cancelado por el medio no gasta número.
    abandoned = await _open_sale(client)
    await client.post(f"/api/v1/sales/{abandoned['id']}/cancel")
    second = await charge()

    assert second == first + 1


async def test_sale_location_must_belong_to_its_warehouse(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    warehouse_id, _location_id = await _default_location(client)
    other_warehouse_id = (
        await client.post("/api/v1/warehouses", json={"name": "Otro almacén"})
    ).json()["id"]
    other_location_id = (
        await client.post(
            f"/api/v1/warehouses/{other_warehouse_id}/locations", json={"name": "Otra ubicación"}
        )
    ).json()["id"]

    response = await client.post(
        "/api/v1/sales", json={"warehouse_id": warehouse_id, "location_id": other_location_id}
    )

    assert response.status_code == 422


async def test_cashier_can_list_and_read_sales(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")
    sale = await _open_sale(client)

    listed = (await client.get("/api/v1/sales")).json()
    assert any(s["id"] == sale["id"] for s in listed)

    fetched = await client.get(f"/api/v1/sales/{sale['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == sale["id"]


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/sales")

    assert response.status_code == 401


async def test_the_same_product_twice_is_one_line_of_two(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Tres del mismo producto son una línea de tres, no tres de uno: es
    como se lee un ticket y como se repasa el carrito."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku=f"GROUP-{_next_sku()}")
    sale_id = (await _open_sale(client))["id"]
    package_id = next(p["id"] for p in product["packages"] if p["is_base"])

    for _ in range(3):
        response = await client.post(
            f"/api/v1/sales/{sale_id}/lines",
            json={
                "product_id": product["id"],
                "package_id": package_id,
                "quantity_packages": "1",
            },
        )
        assert response.status_code == 201

    lines = response.json()["lines"]
    assert len(lines) == 1
    assert lines[0]["quantity_packages"] == "3.000000"
    assert lines[0]["quantity_base"] == "3.000000"


async def test_a_line_with_a_discount_stays_on_its_own(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Juntarlas escondería el descuento y cambiaría lo que se cobra."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku=f"GROUP-{_next_sku()}")
    sale_id = (await _open_sale(client))["id"]
    package_id = next(p["id"] for p in product["packages"] if p["is_base"])
    base = {"product_id": product["id"], "package_id": package_id, "quantity_packages": "1"}

    await client.post(f"/api/v1/sales/{sale_id}/lines", json=base)
    response = await client.post(
        f"/api/v1/sales/{sale_id}/lines", json={**base, "discount_rate": "10"}
    )

    lines = response.json()["lines"]
    assert len(lines) == 2
    assert sorted(line["discount_rate"] for line in lines) == ["0.000000", "10.000000"]


async def test_weighed_quantities_add_up_on_one_line(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(client, sku=f"GROUP-{_next_sku()}")
    sale_id = (await _open_sale(client))["id"]
    package_id = next(p["id"] for p in product["packages"] if p["is_base"])

    for grams in ("0.500", "0.300"):
        response = await client.post(
            f"/api/v1/sales/{sale_id}/lines",
            json={
                "product_id": product["id"],
                "package_id": package_id,
                "quantity_packages": grams,
            },
        )

    lines = response.json()["lines"]
    assert len(lines) == 1
    assert lines[0]["quantity_packages"] == "0.800000"


async def test_sales_can_be_listed_by_the_day_they_were_opened(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """La pantalla de ventas pregunta por un día concreto; el rango es
    cerrado por abajo y abierto por arriba para poder pedirlo entero."""
    await login(role_name="ADMIN")
    sale = await _open_sale(client)
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)

    same_day = await client.get(
        "/api/v1/sales",
        params={
            "created_from": today.isoformat(),
            "created_to": (today + timedelta(days=1)).isoformat(),
        },
    )
    assert sale["id"] in [s["id"] for s in same_day.json()]

    tomorrow_only = await client.get(
        "/api/v1/sales",
        params={
            "created_from": (today + timedelta(days=1)).isoformat(),
            "created_to": (today + timedelta(days=2)).isoformat(),
        },
    )
    assert tomorrow_only.json() == []


async def test_sales_business_date_is_resolved_by_the_backend_timezone(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    assert (
        await client.put(
            "/api/v1/settings/options",
            json={"values": {"business.timezone": "Europe/Madrid"}},
        )
    ).status_code == 200
    previous_day = await _open_sale(client)
    next_day = await _open_sale(client)
    await db_session.execute(
        update(Sale)
        .where(Sale.id == previous_day["id"])
        .values(created_at=datetime(2026, 8, 12, 21, 59, tzinfo=UTC))
    )
    await db_session.execute(
        update(Sale)
        .where(Sale.id == next_day["id"])
        .values(created_at=datetime(2026, 8, 12, 22, 1, tzinfo=UTC))
    )
    await db_session.flush()

    response = await client.get("/api/v1/sales", params={"business_date": "2026-08-13"})

    assert response.status_code == 200
    assert [sale["id"] for sale in response.json()] == [next_day["id"]]


async def test_business_date_cannot_be_mixed_with_absolute_sale_bounds(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get(
        "/api/v1/sales",
        params={"business_date": "2026-08-13", "created_from": "2026-08-13T00:00:00Z"},
    )

    assert response.status_code == 422


async def test_absolute_sale_bounds_require_an_explicit_offset(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get("/api/v1/sales", params={"created_from": "2026-08-13T00:00:00"})

    assert response.status_code == 422
    assert "explicit timezone offset" in response.json()["error"]["message"]
