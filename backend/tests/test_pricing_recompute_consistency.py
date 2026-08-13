"""A16: every event must use the same product-price computation."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from httpx import AsyncClient


async def _create_product(client: AsyncClient, *, sku: str, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "sku": sku,
        "name": "Producto A16",
        "base_unit_name": "UNIDAD",
        "cost": "10",
        "list_price": "10",
        "tax_rate": "0",
        "surcharge_rate": "0",
        "margin_rate": "0",
        "margin_amount": "0.25",
    }
    payload.update(overrides)
    response = await client.post("/api/v1/products", json=payload)
    assert response.status_code == 201
    result: dict[str, Any] = response.json()
    return result


async def _set_formula(client: AsyncClient, product_id: int, text: str) -> dict[str, Any]:
    response = await client.put(
        f"/api/v1/products/{product_id}/pricing/formula",
        json={"price_formula": text},
    )
    assert response.status_code == 200
    result: dict[str, Any] = response.json()
    return result


async def _set_inputs(client: AsyncClient, product_id: int, **values: Any) -> dict[str, Any]:
    response = await client.patch(f"/api/v1/products/{product_id}/pricing", json=values)
    assert response.status_code == 200
    result: dict[str, Any] = response.json()
    return result


async def _default_location(client: AsyncClient) -> tuple[int, int]:
    warehouses = (await client.get("/api/v1/warehouses")).json()
    warehouse = next(row for row in warehouses if row["name"] == "Tienda principal")
    locations = (await client.get(f"/api/v1/warehouses/{warehouse['id']}/locations")).json()
    location = next(row for row in locations if row["name"] == "Almacén")
    return warehouse["id"], location["id"]


async def test_setting_formula_applies_fixed_margin_immediately(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P1: saving and a later recomputation must not produce two prices."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="A16-REPRO")

    saved = await client.put(
        f"/api/v1/products/{product['id']}/pricing/formula",
        json={"price_formula": "cost * 2"},
    )

    assert saved.status_code == 200
    assert Decimal(saved.json()["list_price"]) == Decimal("20.25")


async def test_cost_change_and_restore_returns_to_the_saved_formula_price(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P2: cost-triggered recomputation is reversible and event-independent."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="A16-COST")
    initial = await _set_formula(client, product["id"], "cost * 2")

    changed = await _set_inputs(client, product["id"], cost="12")
    restored = await _set_inputs(client, product["id"], cost="10")

    assert Decimal(initial["list_price"]) == Decimal("20.25")
    assert Decimal(changed["list_price"]) == Decimal("24.25")
    assert restored["list_price"] == initial["list_price"]


async def test_tax_change_and_restore_returns_to_the_saved_formula_price(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P3: the legacy scalar tax input reaches the same canonical path."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="A16-TAX", tax_rate="10")
    text = "cost * (1 + tax_rate / 100)"
    initial = await _set_formula(client, product["id"], text)

    changed = await _set_inputs(client, product["id"], tax_rate="21")
    restored = await _set_inputs(client, product["id"], tax_rate="10")

    assert Decimal(initial["list_price"]) == Decimal("11.25")
    assert Decimal(changed["list_price"]) == Decimal("12.35")
    assert restored["list_price"] == initial["list_price"]


async def test_fixed_margin_change_and_restore_has_no_drift(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P4: X -> Y -> X returns exactly to the first rounded price."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="A16-FIXED")
    initial = await _set_formula(client, product["id"], "cost")

    changed = await _set_inputs(client, product["id"], margin_amount="1")
    restored = await _set_inputs(client, product["id"], margin_amount="0.25")

    assert Decimal(initial["list_price"]) == Decimal("10.25")
    assert Decimal(changed["list_price"]) == Decimal("11")
    assert restored["list_price"] == initial["list_price"]


async def test_explicit_zero_fixed_margin_is_not_treated_as_inheritance(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P5: explicit zero wins; NULL gives the category amount back."""
    await login(role_name="ADMIN")
    category = (await client.post("/api/v1/product-categories", json={"name": "A16 cero"})).json()
    assert (
        await client.patch(
            f"/api/v1/product-categories/{category['id']}/pricing",
            json={"margin_amount": "0.75"},
        )
    ).status_code == 200
    product = await _create_product(
        client,
        sku="A16-ZERO",
        category_id=category["id"],
        margin_amount="0",
    )

    explicit_zero = await _set_formula(client, product["id"], "cost")
    inherited = await _set_inputs(client, product["id"], margin_amount=None)

    assert explicit_zero["margin_amount"] == "0.000000"
    assert Decimal(explicit_zero["list_price"]) == Decimal("10")
    assert inherited["margin_amount"] is None
    assert Decimal(inherited["list_price"]) == Decimal("10.75")


async def test_percentage_only_formula_keeps_its_existing_semantics(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P6/no-fixed: centralisation does not change percentage pricing."""
    await login(role_name="ADMIN")
    product = await _create_product(
        client,
        sku="A16-PERCENT",
        margin_rate="20",
        margin_amount="0",
    )

    saved = await _set_formula(client, product["id"], "cost * (1 + margin_rate / 100)")
    recomputed = await _set_inputs(client, product["id"], cost="11")

    assert Decimal(saved["list_price"]) == Decimal("12")
    assert Decimal(recomputed["list_price"]) == Decimal("13.20")


async def test_percentage_and_fixed_margin_use_the_same_order_on_every_trigger(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P7: percentage is evaluated in formula; fixed amount is added after."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="A16-MIXED", margin_rate="20")
    text = "cost * (1 + margin_rate / 100)"
    initial = await _set_formula(client, product["id"], text)

    changed = await _set_inputs(client, product["id"], margin_rate="30")
    restored = await _set_inputs(client, product["id"], margin_rate="20")

    assert Decimal(initial["list_price"]) == Decimal("12.25")
    assert Decimal(changed["list_price"]) == Decimal("13.25")
    assert restored["list_price"] == initial["list_price"]


async def test_saving_the_same_formula_twice_does_not_accumulate_fixed_margin(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P8: computation starts from inputs, never from the previous PVP."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="A16-IDEMPOTENT")

    first = await _set_formula(client, product["id"], "cost * 2")
    second = await _set_formula(client, product["id"], "cost * 2")

    assert first["list_price"] == second["list_price"] == "20.250000"


async def test_invalid_formula_leaves_formula_and_price_coherent(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P9: validation precedes mutation; no partial formula/price pair remains."""
    await login(role_name="ADMIN")
    product = await _create_product(client, sku="A16-INVALID")
    before = await _set_formula(client, product["id"], "cost * 2")

    rejected = await client.put(
        f"/api/v1/products/{product['id']}/pricing/formula",
        # Structurally valid but impossible for this product. This reaches
        # the canonical evaluator after assigning the candidate formula,
        # so request rollback—not only the initial syntax check—is covered.
        json={"price_formula": "cost / 0"},
    )
    after = (await client.get(f"/api/v1/products/{product['id']}")).json()

    assert rejected.status_code == 422
    assert after["price_formula"] == before["price_formula"] == "cost * 2"
    assert after["list_price"] == before["list_price"] == "20.250000"


async def test_completed_sale_and_refund_keep_price_before_formula_change(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P10: current catalogue recomputation never touches economic snapshots."""
    await login(role_name="ADMIN")
    product = await _create_product(
        client,
        sku="A16-HISTORY",
        tracks_stock=False,
    )
    product = await _set_formula(client, product["id"], "cost * 2")
    warehouse_id, location_id = await _default_location(client)
    sale = (
        await client.post(
            "/api/v1/sales",
            json={"warehouse_id": warehouse_id, "location_id": location_id},
        )
    ).json()
    package_id = next(row["id"] for row in product["packages"] if row["is_base"])
    added = (
        await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={
                "product_id": product["id"],
                "package_id": package_id,
                "quantity_packages": "1",
            },
        )
    ).json()
    completed = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": added["total"]}]},
    )
    assert completed.status_code == 200

    current = await _set_formula(client, product["id"], "cost * 3")
    historical = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    returned = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "refund_method": "CASH",
            "lines": [
                {
                    "sale_line_id": historical["lines"][0]["id"],
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "0",
                }
            ],
        },
    )

    assert Decimal(current["list_price"]) == Decimal("30.25")
    assert historical["lines"][0]["unit_price"] == "20.250000"
    assert Decimal(returned.json()["total_refund"]) == Decimal("20.25")


async def test_box_price_is_corrected_base_price_times_snapshotted_factor(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """P11/A4: A16 changes the base price, not package-price semantics."""
    await login(role_name="ADMIN")
    product = await _create_product(
        client,
        sku="A16-BOX",
        tracks_stock=False,
    )
    product = await _set_formula(client, product["id"], "cost * 2")
    product = (
        await client.post(
            f"/api/v1/products/{product['id']}/packages",
            json={"name": "CAJA 6", "factor": "6"},
        )
    ).json()
    box = next(row for row in product["packages"] if row["name"] == "CAJA 6")
    warehouse_id, location_id = await _default_location(client)
    sale = (
        await client.post(
            "/api/v1/sales",
            json={"warehouse_id": warehouse_id, "location_id": location_id},
        )
    ).json()

    added = await client.post(
        f"/api/v1/sales/{sale['id']}/lines",
        json={
            "product_id": product["id"],
            "package_id": box["id"],
            "quantity_packages": "1",
        },
    )

    assert added.status_code == 201
    line = added.json()["lines"][0]
    assert line["unit_price"] == "20.250000"
    assert line["package_factor"] == "6.000000"
    assert line["package_price"] == "121.500000"
