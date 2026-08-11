"""Impuestos, herencia de margen/IVA entre categoría y producto, y la
fórmula del PVP de la tienda. Un producto (o una categoría) aplica **un**
impuesto como mucho — dos se sumarían y darían una tasa que no existe; el
recargo de equivalencia viaja dentro del propio impuesto. El margen y el
impuesto de la categoría son el valor por defecto que el producto pisa si
fija el suyo. See app/pricing/service.py's own
docstrings on effective_tax_rate/effective_margin_rate for the rule this
exercises end to end.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient

DEFAULT_FORMULA = (
    "(cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)"
)


def _product_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "Refresco 33cl",
        "base_unit_name": "UNIT",
        "cost": "10",
        "list_price": "10",
        "min_stock": "0",
    }
    payload.update(overrides)
    return payload


async def _create_category(client: AsyncClient, name: str) -> int:
    response = await client.post("/api/v1/product-categories", json={"name": name})
    assert response.status_code == 201
    result: int = response.json()["id"]
    return result


async def _create_tax(client: AsyncClient, name: str, rate: str) -> int:
    response = await client.post("/api/v1/taxes", json={"name": name, "rate": rate})
    assert response.status_code == 201
    result: int = response.json()["id"]
    return result


async def test_admin_can_create_and_list_taxes(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    tax_id = await _create_tax(client, "IVA general", "21")

    response = await client.get("/api/v1/taxes")
    assert response.status_code == 200
    assert {"id": tax_id, "name": "IVA general", "rate": "21.000000", "is_active": True} in [
        {k: v for k, v in t.items() if k in ("id", "name", "rate", "is_active")}
        for t in response.json()
    ]


async def test_duplicate_tax_name_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await _create_tax(client, "IVA reducido", "10")

    response = await client.post("/api/v1/taxes", json={"name": "IVA reducido", "rate": "10"})

    assert response.status_code == 409


async def test_admin_can_rename_a_tax_and_change_its_rate(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    tax_id = await _create_tax(client, "IVA provisional", "20")

    response = await client.patch(
        f"/api/v1/taxes/{tax_id}", json={"name": "IVA general", "rate": "21"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "IVA general"
    assert body["rate"] == "21.000000"


async def test_renaming_a_tax_to_an_existing_name_is_a_conflict(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    await _create_tax(client, "IVA A", "21")
    tax_b = await _create_tax(client, "IVA B", "10")

    response = await client.patch(f"/api/v1/taxes/{tax_b}", json={"name": "IVA A"})

    assert response.status_code == 409


async def test_changing_a_taxs_rate_recomputes_products_that_use_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    tax_id = await _create_tax(client, "IVA a cambiar", "10")
    product_id = (await client.post("/api/v1/products", json=_product_payload(cost="10"))).json()[
        "id"
    ]
    await client.patch(
        f"/api/v1/products/{product_id}/pricing",
        json={"margin_rate": "0", "tax_ids": [tax_id]},
    )
    # (10 + 10*10/100) * 1 = 11
    before = (await client.get(f"/api/v1/products/{product_id}")).json()
    assert Decimal(before["list_price"]) == Decimal("11.000000")

    await client.patch(f"/api/v1/taxes/{tax_id}", json={"rate": "50"})

    after = (await client.get(f"/api/v1/products/{product_id}")).json()
    # (10 + 10*50/100) * 1 = 15
    assert Decimal(after["list_price"]) == Decimal("15.000000")


async def test_product_with_no_explicit_pricing_inherits_the_categorys(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Cambiar el margen/impuestos de una categoría recalcula, sola, a
    todos sus productos sin override propio — sin tocar el producto."""
    await login(role_name="ADMIN")
    category_id = await _create_category(client, "Bebidas")
    tax_id = await _create_tax(client, "IVA general", "21")
    product_id = (
        await client.post(
            "/api/v1/products", json=_product_payload(category_id=category_id, cost="10")
        )
    ).json()["id"]

    set_response = await client.patch(
        f"/api/v1/product-categories/{category_id}/pricing",
        json={"margin_rate": "20", "tax_ids": [tax_id]},
    )
    assert set_response.status_code == 200
    assert set_response.json()["margin_rate"] == "20.000000"

    product = (await client.get(f"/api/v1/products/{product_id}")).json()
    assert product["margin_rate"] is None  # sigue sin valor propio: hereda
    assert product["taxes"] == []  # tampoco tiene impuestos propios
    # (10 + 10*21/100) * (1 + 20/100) = 12.1 * 1.2 = 14.52
    assert Decimal(product["list_price"]) == Decimal("14.520000")


async def test_products_own_margin_and_taxes_override_the_categorys(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category_id = await _create_category(client, "Congelados")
    category_tax_id = await _create_tax(client, "IVA general (congelados)", "21")
    own_tax_id = await _create_tax(client, "IVA reducido (congelados)", "10")
    await client.patch(
        f"/api/v1/product-categories/{category_id}/pricing",
        json={"margin_rate": "20", "tax_ids": [category_tax_id]},
    )
    product_id = (
        await client.post(
            "/api/v1/products", json=_product_payload(category_id=category_id, cost="10")
        )
    ).json()["id"]

    response = await client.patch(
        f"/api/v1/products/{product_id}/pricing",
        json={"margin_rate": "0", "tax_ids": [own_tax_id]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["margin_rate"] == "0.000000"
    assert [t["id"] for t in body["taxes"]] == [own_tax_id]
    # (10 + 10*10/100) * (1 + 0/100) = 11 — su propio 10%, no el 21% heredado.
    assert Decimal(body["list_price"]) == Decimal("11.000000")


async def test_clearing_a_products_override_reverts_to_the_categorys(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    category_id = await _create_category(client, "Limpieza")
    tax_id = await _create_tax(client, "IVA limpieza", "21")
    await client.patch(
        f"/api/v1/product-categories/{category_id}/pricing",
        json={"margin_rate": "20", "tax_ids": [tax_id]},
    )
    product_id = (
        await client.post(
            "/api/v1/products", json=_product_payload(category_id=category_id, cost="10")
        )
    ).json()["id"]
    await client.patch(
        f"/api/v1/products/{product_id}/pricing", json={"margin_rate": "0", "tax_ids": []}
    )

    # tax_ids: [] ya heredaba (vacío = heredar); ahora limpiamos también el
    # margen propio con margin_rate: null explícito.
    response = await client.patch(
        f"/api/v1/products/{product_id}/pricing", json={"margin_rate": None}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["margin_rate"] is None
    # De vuelta al margen/impuesto de la categoría: 14.52 (ver test anterior).
    assert Decimal(body["list_price"]) == Decimal("14.520000")


async def test_an_iva_brings_its_own_surcharge_without_stacking_two_taxes(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Sustituye al test que apilaba dos impuestos: el recargo de
    equivalencia es una columna del propio IVA (`Tax.surcharge_rate`), así
    que se aplica sin necesidad de elegir dos —que ahora se rechaza."""
    await login(role_name="ADMIN")
    tax = (
        await client.post(
            "/api/v1/taxes",
            json={"name": "IVA general (con RE)", "rate": "21", "surcharge_rate": "5.2"},
        )
    ).json()
    product_id = (await client.post("/api/v1/products", json=_product_payload(cost="10"))).json()[
        "id"
    ]

    response = await client.patch(
        f"/api/v1/products/{product_id}/pricing",
        json={"margin_rate": "0", "tax_ids": [tax["id"]]},
    )

    assert response.status_code == 200
    # (10 + 10*21% + 10*5,2%) * 1 = 12,62 — con un solo impuesto elegido.
    assert Decimal(response.json()["list_price"]) == Decimal("12.620000")


async def test_updating_the_store_formula_recomputes_products_without_their_own(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = (await client.post("/api/v1/products", json=_product_payload(cost="10"))).json()[
        "id"
    ]
    await client.patch(
        f"/api/v1/products/{product_id}/pricing", json={"margin_rate": "0", "tax_ids": []}
    )

    response = await client.put(
        "/api/v1/pricing/settings",
        json={"formula": "cost * 2", "prices_include_tax": False},
    )

    assert response.status_code == 200
    product = (await client.get(f"/api/v1/products/{product_id}")).json()
    assert Decimal(product["list_price"]) == Decimal("20.000000")

    # Deja la fórmula por defecto tal y como estaba, para no afectar a
    # otros tests de este módulo que sí cuentan con ella.
    await client.put(
        "/api/v1/pricing/settings",
        json={"formula": DEFAULT_FORMULA, "prices_include_tax": False},
    )


async def test_an_unsafe_formula_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.put(
        "/api/v1/pricing/settings",
        json={"formula": "cost.__class__", "prices_include_tax": False},
    )

    assert response.status_code == 422


async def test_cashier_gets_403_managing_taxes(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    response = await client.post("/api/v1/taxes", json={"name": "X", "rate": "1"})

    assert response.status_code == 403


async def test_recargo_de_equivalencia_end_to_end(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """El caso completo de una tienda minorista en recargo de equivalencia:
    el IVA y el recargo que paga al proveedor van dentro del PVP, en caja se
    cobra la etiqueta tal cual, y el ticket puede desglosar el IVA que
    lleva dentro."""
    await login(role_name="ADMIN")
    default_formula = (await client.get("/api/v1/pricing/settings")).json()["formula"]
    assert (
        await client.put(
            "/api/v1/pricing/settings",
            json={"formula": default_formula, "prices_include_tax": True},
        )
    ).status_code == 200
    try:
        # IVA 21% con su recargo de equivalencia del 5,2%.
        tax = (
            await client.post(
                "/api/v1/taxes", json={"name": "IVA 21 RE", "rate": "21", "surcharge_rate": "5.2"}
            )
        ).json()
        assert tax["surcharge_rate"] == "5.200000"

        product = (
            await client.post(
                "/api/v1/products",
                json={
                    "sku": "RE-TEST",
                    "name": "Detergente",
                    "base_unit_name": "UD",
                    "cost": "10.00",
                    "list_price": "0",
                },
            )
        ).json()
        product = (
            await client.patch(
                f"/api/v1/products/{product['id']}/pricing",
                json={"margin_rate": "20", "tax_ids": [tax["id"]]},
            )
        ).json()

        # (10 + 10*21% + 10*5,2%) * 1,20 = 12,62 * 1,20 = 15,14
        assert Decimal(product["list_price"]) == Decimal("15.140000")

        # En caja se cobra la etiqueta, sin volver a sumar IVA.
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
                "unit_cost": "12.62",
            },
        )
        sale = (
            await client.post(
                "/api/v1/sales", json={"warehouse_id": wh["id"], "location_id": loc["id"]}
            )
        ).json()
        base_id = next(p["id"] for p in product["packages"] if p["is_base"])
        sale = (
            await client.post(
                f"/api/v1/sales/{sale['id']}/lines",
                json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
            )
        ).json()

        assert Decimal(sale["total"]) == Decimal("15.140000")
        line = sale["lines"][0]
        # La línea guarda el IVA efectivo (21), no el recargo: el recargo es
        # coste de compra, nunca se le repercute al cliente.
        assert Decimal(line["tax_rate"]) == Decimal("21.000000")
        # 15,14 / 1,21 = 12,512397 de base; el resto es cuota. La API guarda
        # los 6 decimales del NUMERIC y es el ticket quien redondea a 2.
        assert Decimal(line["tax_amount"]).quantize(Decimal("0.01")) == Decimal("2.63")
    finally:
        await client.put(
            "/api/v1/pricing/settings",
            json={
                "formula": (await client.get("/api/v1/pricing/settings")).json()["formula"],
                "prices_include_tax": False,
            },
        )


async def test_a_price_built_with_tax_in_the_formula_is_charged_as_the_shelf_price(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """La regla que se coló una vez y nunca debe volver a colarse: si la
    fórmula mete el IVA en el PVP, la caja NO lo suma otra vez. Un producto
    etiquetado a 15,14 € se cobra a 15,14 €, no a 18,32 €.

    La migración 5b4760e2a878 deja `prices_include_tax` activado en toda
    tienda cuya fórmula use `tax_rate`, que es lo que sostiene este test
    sin tener que tocar nada a mano."""
    await login(role_name="ADMIN")
    settings = (await client.get("/api/v1/pricing/settings")).json()
    assert "tax_rate" in settings["formula"], "la fórmula de fábrica usa tax_rate"
    assert settings["prices_include_tax"] is True, (
        "una fórmula con tax_rate tiene que venir con el ajuste activado; "
        "si no, la caja cobra el impuesto dos veces"
    )

    tax = (
        await client.post(
            "/api/v1/taxes", json={"name": "IVA doble-cobro", "rate": "21", "surcharge_rate": "5.2"}
        )
    ).json()
    product = (
        await client.post(
            "/api/v1/products",
            json={
                "sku": "NO-DOUBLE-TAX",
                "name": "Detergente",
                "base_unit_name": "UD",
                "cost": "10.00",
                "list_price": "0",
            },
        )
    ).json()
    product = (
        await client.patch(
            f"/api/v1/products/{product['id']}/pricing",
            json={"margin_rate": "20", "tax_ids": [tax["id"]]},
        )
    ).json()
    shelf_price = Decimal(product["list_price"])
    assert shelf_price == Decimal("15.140000")

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
            "unit_cost": "12.62",
        },
    )
    sale = (
        await client.post(
            "/api/v1/sales", json={"warehouse_id": wh["id"], "location_id": loc["id"]}
        )
    ).json()
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    sale = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={"product_id": product["id"], "package_id": base_id, "quantity_packages": "1"},
        )
    ).json()

    assert Decimal(sale["total"]) == shelf_price


async def test_a_tax_can_be_deactivated_and_reactivated(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Regla 14: un impuesto creado por error no se borra, se desactiva —
    y al dejar de contar, los precios que lo aplicaban se recalculan solos."""
    await login(role_name="ADMIN")
    tax_id = await _create_tax(client, "IVA a retirar", "21")
    product_id = (await client.post("/api/v1/products", json=_product_payload(cost="10"))).json()[
        "id"
    ]
    await client.patch(
        f"/api/v1/products/{product_id}/pricing",
        json={"margin_rate": "0", "tax_ids": [tax_id]},
    )
    # (10 + 10*21%) * 1 = 12.10
    assert Decimal(
        (await client.get(f"/api/v1/products/{product_id}")).json()["list_price"]
    ) == Decimal("12.100000")

    response = await client.post(f"/api/v1/taxes/{tax_id}/deactivate")

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    # Sin ese impuesto el PVP baja al coste: 10.
    assert Decimal(
        (await client.get(f"/api/v1/products/{product_id}")).json()["list_price"]
    ) == Decimal("10.000000")

    reactivated = await client.post(f"/api/v1/taxes/{tax_id}/activate")

    assert reactivated.status_code == 200
    assert reactivated.json()["is_active"] is True
    assert Decimal(
        (await client.get(f"/api/v1/products/{product_id}")).json()["list_price"]
    ) == Decimal("12.100000")


async def test_deactivating_a_tax_keeps_it_listed_rather_than_deleting_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Lo que ya se vendió con él tiene que seguir siendo legible."""
    await login(role_name="ADMIN")
    tax_id = await _create_tax(client, "IVA histórico", "4")

    await client.post(f"/api/v1/taxes/{tax_id}/deactivate")

    listed = {t["id"]: t for t in (await client.get("/api/v1/taxes")).json()}
    assert tax_id in listed
    assert listed[tax_id]["is_active"] is False


async def test_cashier_cannot_deactivate_a_tax(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    tax_id = await _create_tax(client, "IVA protegido", "21")

    await login(role_name="CASHIER")

    assert (await client.post(f"/api/v1/taxes/{tax_id}/deactivate")).status_code == 403


async def test_two_taxes_at_once_are_rejected_on_a_category_and_on_a_product(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Un producto o una categoría tienen *un* tipo de IVA: dos se sumarían
    y darían una tasa que no existe (21 + 10 = 31%)."""
    await login(role_name="ADMIN")
    iva_21 = await _create_tax(client, "IVA 21 (uno solo)", "21")
    iva_10 = await _create_tax(client, "IVA 10 (uno solo)", "10")
    category_id = await _create_category(client, "Categoría de un IVA")
    product_id = (await client.post("/api/v1/products", json=_product_payload())).json()["id"]

    on_category = await client.patch(
        f"/api/v1/product-categories/{category_id}/pricing",
        json={"tax_ids": [iva_21, iva_10]},
    )
    on_product = await client.patch(
        f"/api/v1/products/{product_id}/pricing", json={"tax_ids": [iva_21, iva_10]}
    )

    assert on_category.status_code == 422
    assert on_product.status_code == 422
    # Uno solo sigue valiendo, y vacío sigue significando "hereda".
    assert (
        await client.patch(
            f"/api/v1/product-categories/{category_id}/pricing", json={"tax_ids": [iva_21]}
        )
    ).status_code == 200
    assert (
        await client.patch(f"/api/v1/products/{product_id}/pricing", json={"tax_ids": []})
    ).status_code == 200
