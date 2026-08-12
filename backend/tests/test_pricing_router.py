"""Pricing endpoints: previewing, setting a formula, manual overrides, and
that every change lands in product_price_history."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient

SPEC_FORMULA = (
    "(cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)"
)


def _product_payload(**overrides: Any) -> dict[str, Any]:
    payload = {
        "sku": "OIL-1L",
        "name": "Aceite de oliva 1L",
        "base_unit_name": "BOTELLA",
        "cost": "3.00",
        "list_price": "4.50",
        "tax_rate": "10",
        "surcharge_rate": "0",
        "margin_rate": "0",
    }
    payload.update(overrides)
    return payload


async def _create_product(client: AsyncClient, **overrides: Any) -> int:
    response = await client.post("/api/v1/products", json=_product_payload(**overrides))
    assert response.status_code == 201
    result: int = response.json()["id"]
    return result


async def test_preview_computes_without_touching_a_product(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/pricing/preview",
        json={
            "formula": SPEC_FORMULA,
            "cost": "10",
            "tax_rate": "21",
            "surcharge_rate": "5",
            "margin_rate": "20",
        },
    )

    assert response.status_code == 200
    assert Decimal(response.json()["result"]) == Decimal("15.12")


async def test_preview_rejects_an_unsafe_formula(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post("/api/v1/pricing/preview", json={"formula": "__import__('os')"})

    assert response.status_code == 422


async def test_setting_a_formula_recomputes_the_list_price(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(
        client, cost="10", tax_rate="21", surcharge_rate="5", margin_rate="20"
    )

    response = await client.put(
        f"/api/v1/products/{product_id}/pricing/formula", json={"price_formula": SPEC_FORMULA}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["price_formula"] == SPEC_FORMULA
    assert body["list_price"] == "15.120000"


async def test_changing_cost_recomputes_price_from_the_existing_formula(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(
        client, cost="10", tax_rate="21", surcharge_rate="5", margin_rate="20"
    )
    await client.put(
        f"/api/v1/products/{product_id}/pricing/formula", json={"price_formula": SPEC_FORMULA}
    )

    response = await client.patch(f"/api/v1/products/{product_id}/pricing", json={"cost": "20"})

    assert response.status_code == 200
    body = response.json()
    # Same formula, double the cost -> double the price: 30.24.
    assert body["list_price"] == "30.240000"


async def test_manual_price_clears_the_formula(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    await client.put(
        f"/api/v1/products/{product_id}/pricing/formula", json={"price_formula": SPEC_FORMULA}
    )

    response = await client.put(
        f"/api/v1/products/{product_id}/pricing/manual-price", json={"list_price": "9.99"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["list_price"] == "9.990000"
    assert body["price_formula"] is None

    # Cambiar el coste después sí recalcula, pero ya no con la fórmula
    # propia (se la llevó el precio manual): con la de la tienda y el
    # margen del producto. Si el coste sube, el PVP sube — decisión
    # explícita del tendero, ver SetPricingInputsRequest.
    after_cost_change = await client.patch(
        f"/api/v1/products/{product_id}/pricing", json={"cost": "50"}
    )
    # 50 + 10% de IVA, sin margen: 55. Ya no son los 9,99 de antes.
    assert after_cost_change.json()["list_price"] == "55.000000"


async def test_clearing_the_formula_keeps_the_last_computed_price(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(
        client, cost="10", tax_rate="21", surcharge_rate="5", margin_rate="20"
    )
    set_response = await client.put(
        f"/api/v1/products/{product_id}/pricing/formula", json={"price_formula": SPEC_FORMULA}
    )
    computed_price = set_response.json()["list_price"]

    response = await client.delete(f"/api/v1/products/{product_id}/pricing/formula")

    assert response.status_code == 200
    assert response.json()["price_formula"] is None
    assert response.json()["list_price"] == computed_price


async def test_setting_an_unsafe_formula_on_a_real_product_is_rejected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)

    response = await client.put(
        f"/api/v1/products/{product_id}/pricing/formula",
        json={"price_formula": "cost.__class__"},
    )

    assert response.status_code == 422


async def test_price_history_records_every_change(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client, cost="3.00")

    await client.put(
        f"/api/v1/products/{product_id}/pricing/formula", json={"price_formula": SPEC_FORMULA}
    )
    await client.patch(f"/api/v1/products/{product_id}/pricing", json={"cost": "4.00"})
    await client.put(
        f"/api/v1/products/{product_id}/pricing/manual-price", json={"list_price": "7.00"}
    )

    response = await client.get(f"/api/v1/products/{product_id}/pricing/history")

    assert response.status_code == 200
    entries = response.json()
    assert len(entries) == 3
    # Most recent first.
    assert entries[0]["list_price"] == "7.000000"
    assert entries[0]["price_formula"] is None
    assert entries[1]["cost"] == "4.000000"
    assert entries[2]["price_formula"] == SPEC_FORMULA


async def test_cashier_can_preview_but_not_change_pricing(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    preview_response = await client.post(
        "/api/v1/pricing/preview", json={"formula": "cost", "cost": "1"}
    )
    assert preview_response.status_code == 200

    change_response = await client.patch("/api/v1/products/1/pricing", json={"cost": "1"})
    assert change_response.status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.post("/api/v1/pricing/preview", json={"formula": "cost", "cost": "1"})

    assert response.status_code == 401
