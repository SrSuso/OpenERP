"""Suppliers and their product links."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def _create_product(client: AsyncClient, sku: str = "SUP-TEST-1") -> int:
    response = await client.post(
        "/api/v1/products",
        json={
            "sku": sku,
            "name": "Producto de prueba",
            "base_unit_name": "UNIDAD",
            "cost": "1.00",
            "list_price": "2.00",
        },
    )
    assert response.status_code == 201
    result: int = response.json()["id"]
    return result


async def _create_supplier(client: AsyncClient, name: str = "Distribuidora Ejemplo") -> int:
    response = await client.post("/api/v1/suppliers", json={"name": name, "tax_id": "B12345678"})
    assert response.status_code == 201
    result: int = response.json()["id"]
    return result


async def test_admin_can_create_and_list_suppliers(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    supplier_id = await _create_supplier(client)

    list_response = await client.get("/api/v1/suppliers")
    assert list_response.status_code == 200
    assert any(s["id"] == supplier_id for s in list_response.json())


async def test_deactivate_supplier(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = await _create_supplier(client)

    response = await client.post(f"/api/v1/suppliers/{supplier_id}/deactivate")
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    active_list = await client.get("/api/v1/suppliers")
    assert supplier_id not in {s["id"] for s in active_list.json()}

    full_list = await client.get("/api/v1/suppliers", params={"active_only": False})
    assert supplier_id in {s["id"] for s in full_list.json()}


async def test_reactivate_supplier(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = await _create_supplier(client)
    await client.post(f"/api/v1/suppliers/{supplier_id}/deactivate")

    response = await client.post(f"/api/v1/suppliers/{supplier_id}/activate")
    assert response.status_code == 200
    assert response.json()["is_active"] is True

    active_list = await client.get("/api/v1/suppliers")
    assert supplier_id in {s["id"] for s in active_list.json()}


async def test_link_product_to_supplier(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    supplier_id = await _create_supplier(client)

    response = await client.put(
        f"/api/v1/products/{product_id}/suppliers/{supplier_id}",
        json={"supplier_sku": "PROV-001", "supplier_cost": "0.80", "is_preferred": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["supplier_sku"] == "PROV-001"
    assert body["supplier_cost"] == "0.800000"
    assert body["is_preferred"] is True
    assert body["product_id"] == product_id
    assert body["supplier_id"] == supplier_id


async def test_linking_again_updates_the_existing_link(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    supplier_id = await _create_supplier(client)

    await client.put(
        f"/api/v1/products/{product_id}/suppliers/{supplier_id}",
        json={"supplier_cost": "0.80"},
    )
    response = await client.put(
        f"/api/v1/products/{product_id}/suppliers/{supplier_id}",
        json={"supplier_cost": "0.75"},
    )

    assert response.status_code == 200
    assert response.json()["supplier_cost"] == "0.750000"

    links = await client.get(f"/api/v1/products/{product_id}/suppliers")
    assert len(links.json()) == 1


async def test_list_suppliers_for_a_product_and_products_for_a_supplier(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    supplier_id = await _create_supplier(client)
    await client.put(
        f"/api/v1/products/{product_id}/suppliers/{supplier_id}", json={"supplier_cost": "1.00"}
    )

    by_product = await client.get(f"/api/v1/products/{product_id}/suppliers")
    assert by_product.status_code == 200
    assert [link["supplier_id"] for link in by_product.json()] == [supplier_id]

    by_supplier = await client.get(f"/api/v1/suppliers/{supplier_id}/products")
    assert by_supplier.status_code == 200
    assert [link["product_id"] for link in by_supplier.json()] == [product_id]


async def test_cannot_remove_the_preferred_supplier_link_without_replacing_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    supplier_id = await _create_supplier(client)
    await client.put(
        f"/api/v1/products/{product_id}/suppliers/{supplier_id}",
        json={"supplier_cost": "1.00", "is_preferred": True},
    )

    response = await client.delete(f"/api/v1/products/{product_id}/suppliers/{supplier_id}")

    assert response.status_code == 409


async def test_can_remove_a_non_preferred_supplier_link(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    product_id = await _create_product(client)
    supplier_id = await _create_supplier(client)
    await client.put(
        f"/api/v1/products/{product_id}/suppliers/{supplier_id}", json={"supplier_cost": "1.00"}
    )

    response = await client.delete(f"/api/v1/products/{product_id}/suppliers/{supplier_id}")

    assert response.status_code == 204
    links = await client.get(f"/api/v1/products/{product_id}/suppliers")
    assert links.json() == []


async def test_linking_a_nonexistent_product_is_a_validation_error(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = await _create_supplier(client)

    response = await client.put(
        f"/api/v1/products/999999/suppliers/{supplier_id}", json={"supplier_cost": "1.00"}
    )

    assert response.status_code == 422


async def test_supplier_changes_are_audited(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    supplier_id = await _create_supplier(client)

    log_response = await client.get(
        "/api/v1/audit-log", params={"entity_type": "supplier", "entity_id": supplier_id}
    )
    assert log_response.status_code == 200
    actions = [e["action"] for e in log_response.json()]
    assert "created" in actions


async def test_cashier_cannot_read_or_manage_suppliers(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    assert (await client.get("/api/v1/suppliers")).status_code == 403
    assert (await client.post("/api/v1/suppliers", json={"name": "X"})).status_code == 403


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/suppliers")

    assert response.status_code == 401
