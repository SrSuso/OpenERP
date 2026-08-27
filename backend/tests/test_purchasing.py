"""Purchase orders: DRAFT -> ORDERED -> CANCELLED (phase 6's slice of the
state machine — PARTIALLY_RECEIVED/RECEIVED are phase 9's).

Covers the phase 6 acceptance case from the plan:
  9. Create an order for 100 units.
(receiving 60/40 and the PARTIALLY_RECEIVED/RECEIVED transitions are
exercised in phase 9's tests, once receiving exists)
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def _create_product(client: AsyncClient, sku: str = "PUR-TEST-1") -> dict[str, Any]:
    response = await client.post(
        "/api/v1/products",
        json={
            "sku": sku,
            "name": "Producto de compra",
            "base_unit_name": "UNIDAD",
            "cost": "1.00",
            "list_price": "2.00",
        },
    )
    assert response.status_code == 201
    body: dict[str, Any] = response.json()
    return body


async def _create_supplier(client: AsyncClient, name: str = "Proveedor de prueba") -> int:
    response = await client.post("/api/v1/suppliers", json={"name": name})
    assert response.status_code == 201
    result: int = response.json()["id"]
    return result


async def _create_draft_order(client: AsyncClient) -> tuple[int, dict[str, Any]]:
    supplier_id = await _create_supplier(client)
    product = await _create_product(client)
    order_response = await client.post("/api/v1/purchase-orders", json={"supplier_id": supplier_id})
    assert order_response.status_code == 201
    order_id: int = order_response.json()["id"]
    return order_id, product


async def test_create_order_starts_as_draft(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = await _create_supplier(client)

    response = await client.post("/api/v1/purchase-orders", json={"supplier_id": supplier_id})

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "DRAFT"
    assert body["lines"] == []
    assert body["ordered_at"] is None


async def test_create_order_accepts_multiple_lines_atomically(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = await _create_supplier(client)
    first = await _create_product(client, sku="PUR-BATCH-1")
    second = await _create_product(client, sku="PUR-BATCH-2")
    first_base = next(package["id"] for package in first["packages"] if package["is_base"])
    second_base = next(package["id"] for package in second["packages"] if package["is_base"])

    response = await client.post(
        "/api/v1/purchase-orders",
        json={
            "supplier_id": supplier_id,
            "lines": [
                {
                    "product_id": first["id"],
                    "package_id": first_base,
                    "quantity_packages": "2",
                    "unit_cost": "0.80",
                },
                {
                    "product_id": second["id"],
                    "package_id": second_base,
                    "quantity_packages": "3",
                    "unit_cost": "1.20",
                },
            ],
        },
    )

    assert response.status_code == 201
    order = response.json()
    assert [line["product_id"] for line in order["lines"]] == [first["id"], second["id"]]
    assert order["total"] == "5.200000"


async def test_invalid_line_does_not_create_a_partial_batch_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = await _create_supplier(client)
    product = await _create_product(client, sku="PUR-BATCH-INVALID")
    base_id = next(package["id"] for package in product["packages"] if package["is_base"])

    response = await client.post(
        "/api/v1/purchase-orders",
        json={
            "supplier_id": supplier_id,
            "lines": [
                {
                    "product_id": product["id"],
                    "package_id": base_id,
                    "quantity_packages": "1",
                    "unit_cost": "1",
                },
                {
                    "product_id": product["id"],
                    "package_id": 999_999,
                    "quantity_packages": "1",
                    "unit_cost": "1",
                },
            ],
        },
    )

    assert response.status_code == 422
    assert (await client.get("/api/v1/purchase-orders")).json() == []


async def test_order_of_100_units_via_a_box_of_6(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """The spec's "pedido de 100 unidades" case: ordering through a
    presentation still lands as 100 base units."""
    await login(role_name="ADMIN")
    order_id, product = await _create_draft_order(client)
    box_id = next(p["id"] for p in product["packages"] if p["is_base"])
    # Base package factor is 1, so 100 "units" of the base package = 100.

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": product["id"],
            "package_id": box_id,
            "quantity_packages": "100",
            "unit_cost": "0.90",
        },
    )

    assert response.status_code == 201
    line = response.json()["lines"][0]
    assert line["quantity_packages"] == "100.000000"
    assert line["quantity_ordered"] == "100.000000"
    assert line["quantity_received"] == "0.000000"


async def test_line_totals_are_computed_from_snapshots(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, product = await _create_draft_order(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "10",
            "unit_cost": "2.00",
            "tax_rate": "21",
            "discount_rate": "10",
        },
    )

    line = response.json()["lines"][0]
    # subtotal 20, discount 10% -> 2, net 18, tax 21% of 18 -> 3.78, total 21.78
    assert line["subtotal"] == "20.000000"
    assert line["discount_amount"] == "2.000000"
    assert line["tax_amount"] == "3.780000"
    assert line["total"] == "21.780000"
    assert response.json()["total"] == "21.780000"


async def test_placing_an_order_requires_at_least_one_line(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, _product = await _create_draft_order(client)

    response = await client.post(f"/api/v1/purchase-orders/{order_id}/place")

    assert response.status_code == 422


async def test_placing_an_order_moves_it_to_ordered(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, product = await _create_draft_order(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "5",
            "unit_cost": "1",
        },
    )

    response = await client.post(f"/api/v1/purchase-orders/{order_id}/place")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ORDERED"
    assert body["ordered_at"] is not None


async def test_cannot_add_lines_to_a_placed_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, product = await _create_draft_order(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "5",
            "unit_cost": "1",
        },
    )
    await client.post(f"/api/v1/purchase-orders/{order_id}/place")

    response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "1",
            "unit_cost": "1",
        },
    )

    assert response.status_code == 409


async def test_cannot_place_an_already_placed_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, product = await _create_draft_order(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "5",
            "unit_cost": "1",
        },
    )
    await client.post(f"/api/v1/purchase-orders/{order_id}/place")

    response = await client.post(f"/api/v1/purchase-orders/{order_id}/place")

    assert response.status_code == 409


async def test_cancel_a_draft_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, _product = await _create_draft_order(client)

    response = await client.post(f"/api/v1/purchase-orders/{order_id}/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"


async def test_cancel_an_ordered_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, product = await _create_draft_order(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "5",
            "unit_cost": "1",
        },
    )
    await client.post(f"/api/v1/purchase-orders/{order_id}/place")

    response = await client.post(f"/api/v1/purchase-orders/{order_id}/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"


async def test_cannot_cancel_an_already_cancelled_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, _product = await _create_draft_order(client)
    await client.post(f"/api/v1/purchase-orders/{order_id}/cancel")

    response = await client.post(f"/api/v1/purchase-orders/{order_id}/cancel")

    assert response.status_code == 409


async def test_remove_line_from_draft_order(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, product = await _create_draft_order(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])
    add_response = await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "5",
            "unit_cost": "1",
        },
    )
    line_id = add_response.json()["lines"][0]["id"]

    response = await client.delete(f"/api/v1/purchase-orders/{order_id}/lines/{line_id}")

    assert response.status_code == 200
    assert response.json()["lines"] == []


async def test_a_draft_purchase_line_can_be_corrected(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    order_id, first = await _create_draft_order(client)
    second = await _create_product(client, sku="PUR-CORRECTED")
    first_base = next(package["id"] for package in first["packages"] if package["is_base"])
    second_base = next(package["id"] for package in second["packages"] if package["is_base"])
    added = await client.post(
        f"/api/v1/purchase-orders/{order_id}/lines",
        json={
            "product_id": first["id"],
            "package_id": first_base,
            "quantity_packages": "1",
            "unit_cost": "1",
        },
    )
    line_id = added.json()["lines"][0]["id"]

    corrected = await client.put(
        f"/api/v1/purchase-orders/{order_id}/lines/{line_id}",
        json={
            "product_id": second["id"],
            "package_id": second_base,
            "quantity_packages": "4",
            "unit_cost": "1.25",
            "tax_rate": "10",
            "discount_rate": "20",
        },
    )

    assert corrected.status_code == 200
    line = corrected.json()["lines"][0]
    assert line["id"] == line_id
    assert line["product_id"] == second["id"]
    assert line["quantity_ordered"] == "4.000000"
    assert line["total"] == "4.400000"


async def test_product_purchase_history_orders_most_recent_first(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_a = await _create_supplier(client, name="Proveedor A")
    supplier_b = await _create_supplier(client, name="Proveedor B")
    product = await _create_product(client)
    base_id = next(p["id"] for p in product["packages"] if p["is_base"])

    order_a = (
        await client.post("/api/v1/purchase-orders", json={"supplier_id": supplier_a})
    ).json()["id"]
    await client.post(
        f"/api/v1/purchase-orders/{order_a}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "1",
            "unit_cost": "1",
        },
    )
    order_b = (
        await client.post("/api/v1/purchase-orders", json={"supplier_id": supplier_b})
    ).json()["id"]
    await client.post(
        f"/api/v1/purchase-orders/{order_b}/lines",
        json={
            "product_id": product["id"],
            "package_id": base_id,
            "quantity_packages": "2",
            "unit_cost": "1",
        },
    )

    response = await client.get(f"/api/v1/products/{product['id']}/purchase-history")

    assert response.status_code == 200
    entries = response.json()
    assert len(entries) == 2
    assert entries[0]["purchase_order_id"] == order_b
    assert entries[1]["purchase_order_id"] == order_a


async def test_cashier_cannot_read_or_manage_purchase_orders(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/purchase-orders")).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/purchase-orders")

    assert response.status_code == 401
