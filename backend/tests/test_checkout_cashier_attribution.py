"""A9.1: the authenticated checkout actor is the completed sale's cashier."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditLog
from app.sales.models import Payment
from app.users.models import User
from tests.conftest import DEFAULT_PASSWORD


async def _login(client: AsyncClient, user: User) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": DEFAULT_PASSWORD},
    )
    assert response.status_code == 200


async def _switch_user(client: AsyncClient, user: User) -> None:
    assert (await client.post("/api/v1/auth/logout")).status_code == 204
    await _login(client, user)


async def _pos_setup(
    client: AsyncClient,
    *,
    tag: str,
    terminals: int = 1,
    ticket_with_cashier: bool = False,
) -> tuple[int, int, list[int], dict[str, Any]]:
    warehouse_response = await client.post(
        "/api/v1/warehouses", json={"name": f"A9.1 {tag} warehouse"}
    )
    assert warehouse_response.status_code == 201
    warehouse_id = warehouse_response.json()["id"]
    location_response = await client.post(
        f"/api/v1/warehouses/{warehouse_id}/locations",
        json={"name": f"A9.1 {tag} location"},
    )
    assert location_response.status_code == 201
    location_id = location_response.json()["id"]
    terminal_ids: list[int] = []
    for number in range(1, terminals + 1):
        response = await client.post(
            "/api/v1/pos-terminals",
            json={"name": f"A9.1 {tag} caja {number}", "warehouse_id": warehouse_id},
        )
        assert response.status_code == 201
        terminal_ids.append(response.json()["id"])

    product_response = await client.post(
        "/api/v1/products",
        json={
            "sku": f"A91-{tag}",
            "name": f"A9.1 {tag}",
            "base_unit_name": "UNIDAD",
            "cost": "1",
            "list_price": "1",
            "tax_rate": "0",
            "tracks_stock": False,
        },
    )
    assert product_response.status_code == 201
    if ticket_with_cashier:
        template_response = await client.post(
            "/api/v1/ticket-templates",
            json={"name": f"A9.1 {tag}", "width_mm": 58, "show_cashier": True},
        )
        assert template_response.status_code == 201
    return warehouse_id, location_id, terminal_ids, product_response.json()


async def _open_sale(
    client: AsyncClient,
    *,
    warehouse_id: int,
    location_id: int,
    terminal_id: int,
    claimed_cashier_id: int | None = None,
) -> dict[str, Any]:
    payload = {
        "warehouse_id": warehouse_id,
        "location_id": location_id,
        "terminal_id": terminal_id,
    }
    if claimed_cashier_id is not None:
        payload["cashier_user_id"] = claimed_cashier_id
    response = await client.post("/api/v1/sales", json=payload)
    assert response.status_code == 201
    result: dict[str, Any] = response.json()
    return result


async def _add_line(
    client: AsyncClient,
    sale_id: int,
    terminal_id: int,
    product: dict[str, Any],
) -> dict[str, Any]:
    response = await client.post(
        f"/api/v1/sales/{sale_id}/lines",
        headers={"X-POS-Terminal-ID": str(terminal_id)},
        json={
            "product_id": product["id"],
            "package_id": product["packages"][0]["id"],
            "quantity_packages": "1",
        },
    )
    assert response.status_code == 201
    result: dict[str, Any] = response.json()
    return result


async def _checkout(
    client: AsyncClient,
    sale_id: int,
    terminal_id: int,
    *,
    idempotency_key: str | None = None,
    claimed_cashier_id: int | None = None,
) -> dict[str, Any]:
    headers = {"X-POS-Terminal-ID": str(terminal_id)}
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    payload: dict[str, Any] = {"payments": [{"method": "CASH", "amount": "1"}]}
    if claimed_cashier_id is not None:
        payload["cashier_user_id"] = claimed_cashier_id
    response = await client.post(
        f"/api/v1/sales/{sale_id}/checkout",
        headers=headers,
        json=payload,
    )
    assert response.status_code == 200
    result: dict[str, Any] = response.json()
    return result


async def test_creator_checkout_and_client_cashier_claim_use_authenticated_actor(
    client: AsyncClient,
    make_user: Callable[..., Awaitable[User]],
) -> None:
    """C1/C7: even explicit client fields cannot impersonate another cashier."""
    admin = await make_user(email="a91-c1-admin@example.com", role_name="ADMIN")
    cashier = await make_user(
        email="a91-c1-cashier@example.com", role_name="CASHIER", full_name="Cashier A"
    )
    impersonated = await make_user(
        email="a91-c1-target@example.com", role_name="CASHIER", full_name="Cashier target"
    )
    await _login(client, admin)
    warehouse_id, location_id, (terminal_id,), product = await _pos_setup(client, tag="C1")

    await _switch_user(client, cashier)
    sale = await _open_sale(
        client,
        warehouse_id=warehouse_id,
        location_id=location_id,
        terminal_id=terminal_id,
        claimed_cashier_id=impersonated.id,
    )
    assert sale["cashier_user_id"] == cashier.id
    await _add_line(client, sale["id"], terminal_id, product)
    completed = await _checkout(
        client,
        sale["id"],
        terminal_id,
        claimed_cashier_id=impersonated.id,
    )

    assert completed["cashier_user_id"] == cashier.id
    assert completed["cashier_name"] == "Cashier A"


async def test_different_checkout_actor_owns_history_ticket_report_and_audit(
    client: AsyncClient,
    db_session: AsyncSession,
    make_user: Callable[..., Awaitable[User]],
) -> None:
    """C2/C5: checkout actor B and its name snapshot own every consumer."""
    admin = await make_user(email="a91-c2-admin@example.com", role_name="ADMIN")
    creator = await make_user(
        email="a91-c2-creator@example.com", role_name="CASHIER", full_name="Cashier A"
    )
    checkout_actor = await make_user(
        email="a91-c2-checkout@example.com", role_name="CASHIER", full_name="Cashier B original"
    )
    await _login(client, admin)
    warehouse_id, location_id, (terminal_id,), product = await _pos_setup(
        client, tag="C2", ticket_with_cashier=True
    )

    await _switch_user(client, creator)
    sale = await _open_sale(
        client,
        warehouse_id=warehouse_id,
        location_id=location_id,
        terminal_id=terminal_id,
    )
    await _add_line(client, sale["id"], terminal_id, product)
    await _switch_user(client, checkout_actor)
    recovered = (
        await client.get(
            "/api/v1/sales",
            params={"status": "DRAFT", "terminal_id": terminal_id},
        )
    ).json()
    assert [draft["id"] for draft in recovered] == [sale["id"]]
    completed = await _checkout(client, sale["id"], terminal_id)

    assert completed["cashier_user_id"] == checkout_actor.id
    assert completed["cashier_name"] == "Cashier B original"
    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.entity_type == "sale",
                AuditLog.entity_id == sale["id"],
                AuditLog.action == "completed",
            )
        )
    ).scalar_one()
    assert audit.user_id == checkout_actor.id
    assert audit.before_data is not None
    assert audit.before_data["cashier_user_id"] == creator.id
    assert audit.after_data is not None
    assert audit.after_data["cashier_user_id"] == checkout_actor.id
    assert audit.after_data["cashier_name"] == "Cashier B original"

    await db_session.execute(
        update(User).where(User.id == checkout_actor.id).values(full_name="Cashier B renamed later")
    )
    await db_session.flush()
    await _switch_user(client, admin)
    renamed_terminal = await client.patch(
        f"/api/v1/pos-terminals/{terminal_id}", json={"name": "Renamed till"}
    )
    assert renamed_terminal.status_code == 200

    historical = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert historical["cashier_user_id"] == checkout_actor.id
    assert historical["cashier_name"] == "Cashier B original"
    assert historical["terminal_id"] == terminal_id
    assert historical["terminal_name"] == "Renamed till"
    ticket = await client.post(f"/api/v1/sales/{sale['id']}/tickets")
    assert ticket.status_code == 201
    assert "Cashier B original" in ticket.json()["rendered_text"]
    assert "Cashier B renamed later" not in ticket.json()["rendered_text"]

    report = await client.post(
        "/api/v1/reports/run",
        json={
            "subject": "SALES",
            "dimensions": ["cashier"],
            "metrics": ["tickets"],
            "filters": {
                "product_id": product["id"],
                "cashier_user_id": checkout_actor.id,
            },
        },
    )
    assert report.status_code == 200
    assert report.json()["rows"] == [{"cashier_name": "Cashier B original", "tickets": 1}]
    creator_report = await client.post(
        "/api/v1/reports/run",
        json={
            "subject": "SALES",
            "dimensions": ["cashier"],
            "metrics": ["tickets"],
            "filters": {
                "product_id": product["id"],
                "cashier_user_id": creator.id,
            },
        },
    )
    assert creator_report.status_code == 200
    assert creator_report.json()["rows"] == []

    z_preview = await client.get("/api/v1/z-reports/preview", params={"warehouse_id": warehouse_id})
    assert z_preview.status_code == 200
    assert z_preview.json()["sales_count"] == 1
    assert {"cashier", "cashier_name", "cashier_user_id"}.isdisjoint(z_preview.json())

    await _switch_user(client, creator)
    await _open_sale(
        client,
        warehouse_id=warehouse_id,
        location_id=location_id,
        terminal_id=terminal_id,
    )
    unchanged = (await client.get(f"/api/v1/sales/{sale['id']}")).json()
    assert unchanged["cashier_user_id"] == checkout_actor.id
    assert unchanged["cashier_name"] == "Cashier B original"


async def test_last_actor_to_modify_draft_is_not_the_checkout_cashier(
    client: AsyncClient,
    make_user: Callable[..., Awaitable[User]],
) -> None:
    """C3: B may edit A's terminal cart, but final checkout by A stays A."""
    admin = await make_user(email="a91-c3-admin@example.com", role_name="ADMIN")
    cashier_a = await make_user(
        email="a91-c3-a@example.com", role_name="CASHIER", full_name="Cashier A"
    )
    cashier_b = await make_user(
        email="a91-c3-b@example.com", role_name="CASHIER", full_name="Cashier B"
    )
    await _login(client, admin)
    warehouse_id, location_id, (terminal_id,), product = await _pos_setup(client, tag="C3")
    await _switch_user(client, cashier_a)
    sale = await _open_sale(
        client,
        warehouse_id=warehouse_id,
        location_id=location_id,
        terminal_id=terminal_id,
    )

    await _switch_user(client, cashier_b)
    edited = await _add_line(client, sale["id"], terminal_id, product)
    assert edited["cashier_user_id"] == cashier_a.id
    await _switch_user(client, cashier_a)
    completed = await _checkout(client, sale["id"], terminal_id)
    assert completed["cashier_user_id"] == cashier_a.id
    assert completed["cashier_name"] == "Cashier A"


async def test_same_cashier_on_two_terminals_keeps_terminal_identity_separate(
    client: AsyncClient,
    make_user: Callable[..., Awaitable[User]],
) -> None:
    """C4: cashier identity is independent from both physical terminals."""
    admin = await make_user(email="a91-c4-admin@example.com", role_name="ADMIN")
    cashier = await make_user(
        email="a91-c4-cashier@example.com", role_name="CASHIER", full_name="Cashier shared"
    )
    await _login(client, admin)
    warehouse_id, location_id, terminal_ids, product = await _pos_setup(
        client, tag="C4", terminals=2
    )
    await _switch_user(client, cashier)

    completed_sales = []
    for terminal_id in terminal_ids:
        sale = await _open_sale(
            client,
            warehouse_id=warehouse_id,
            location_id=location_id,
            terminal_id=terminal_id,
        )
        await _add_line(client, sale["id"], terminal_id, product)
        completed_sales.append(await _checkout(client, sale["id"], terminal_id))

    assert {sale["terminal_id"] for sale in completed_sales} == set(terminal_ids)
    assert {sale["cashier_user_id"] for sale in completed_sales} == {cashier.id}
    assert {sale["cashier_name"] for sale in completed_sales} == {"Cashier shared"}


async def test_idempotent_retry_does_not_resnapshot_or_duplicate_checkout(
    client: AsyncClient,
    db_session: AsyncSession,
    make_user: Callable[..., Awaitable[User]],
) -> None:
    """C6: replay returns the first committed actor snapshot and effects."""
    admin = await make_user(email="a91-c6-admin@example.com", role_name="ADMIN")
    creator = await make_user(
        email="a91-c6-creator@example.com", role_name="CASHIER", full_name="Cashier A"
    )
    checkout_actor = await make_user(
        email="a91-c6-checkout@example.com", role_name="CASHIER", full_name="Cashier B first"
    )
    await _login(client, admin)
    warehouse_id, location_id, (terminal_id,), product = await _pos_setup(client, tag="C6")
    await _switch_user(client, creator)
    sale = await _open_sale(
        client,
        warehouse_id=warehouse_id,
        location_id=location_id,
        terminal_id=terminal_id,
    )
    await _add_line(client, sale["id"], terminal_id, product)
    await _switch_user(client, checkout_actor)

    first = await _checkout(client, sale["id"], terminal_id, idempotency_key="a91-retry-checkout")
    await db_session.execute(
        update(User).where(User.id == checkout_actor.id).values(full_name="Cashier B renamed")
    )
    await db_session.flush()
    replay = await _checkout(client, sale["id"], terminal_id, idempotency_key="a91-retry-checkout")

    assert first["cashier_user_id"] == replay["cashier_user_id"] == checkout_actor.id
    assert first["cashier_name"] == replay["cashier_name"] == "Cashier B first"
    assert first["number"] == replay["number"]
    payment_count = await db_session.scalar(
        select(func.count()).select_from(Payment).where(Payment.sale_id == sale["id"])
    )
    audit_count = await db_session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.entity_type == "sale",
            AuditLog.entity_id == sale["id"],
            AuditLog.action == "completed",
        )
    )
    assert payment_count == audit_count == 1
