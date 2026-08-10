"""Multiple taxes, category/product margin+tax inheritance, and the
store-wide pricing formula — added after the 22-phase plan closed, at the
user's request: several taxes may apply to one product at once, and both
margin and taxes can be set on a category as a default that a product's
own explicit value overrides. See app/pricing/service.py's own
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


async def test_several_taxes_on_the_same_product_stack_additively(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    iva_id = await _create_tax(client, "IVA general (stack)", "21")
    recargo_id = await _create_tax(client, "Recargo de equivalencia", "5.2")
    product_id = (await client.post("/api/v1/products", json=_product_payload(cost="10"))).json()[
        "id"
    ]

    response = await client.patch(
        f"/api/v1/products/{product_id}/pricing",
        json={"margin_rate": "0", "tax_ids": [iva_id, recargo_id]},
    )

    assert response.status_code == 200
    # (10 + 10*26.2/100) * 1 = 12.62 — 21% + 5.2% sumados, no sólo uno.
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
