"""A8/A15: independent return quantities and explicit economic refunds."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditLog
from app.catalog.models import Product
from app.core.business_time import business_date_expression
from app.inventory.models import StockMovement
from app.returns.models import Refund
from app.settings.business_time import get_business_timezone
from tests.test_returns import _completed_sale, _create_product, _default_location, _stock


async def _new_sale(
    client: AsyncClient,
    *,
    tag: str,
    quantity: str = "10",
    track_lots: bool = False,
) -> tuple[dict[str, Any], dict[str, Any], int, int]:
    product = await _create_product(
        client,
        sku=f"A8-{tag}",
        list_price="2.00",
        tax_rate="0",
        track_lots=track_lots,
    )
    warehouse_id, location_id = await _default_location(client)
    if track_lots:
        lot = (
            await client.post(
                "/api/v1/lots",
                json={"product_id": product["id"], "lot_number": f"A8-{tag}-SOLD"},
            )
        ).json()
        stocked = await client.post(
            "/api/v1/stock-movements/adjustments",
            json={
                "product_id": product["id"],
                "warehouse_id": warehouse_id,
                "location_id": location_id,
                "movement_type": "ADJUSTMENT",
                "quantity": "20",
                "unit_cost": "1",
                "lot_id": lot["id"],
            },
        )
        assert stocked.status_code == 201
    else:
        await _stock(
            client,
            product_id=product["id"],
            warehouse_id=warehouse_id,
            location_id=location_id,
            quantity="20",
        )
    sale = await _completed_sale(client, product=product, quantity=quantity)
    return product, sale, warehouse_id, location_id


async def _return(
    client: AsyncClient,
    sale: dict[str, Any],
    *,
    refund: str,
    stock: str,
    method: str = "CASH",
    lot_number: str | None = None,
    key: str | None = None,
) -> Response:
    payload: dict[str, Any] = {
        "lines": [
            {
                "sale_line_id": sale["lines"][0]["id"],
                "refund_quantity_packages": refund,
                "stock_return_quantity_packages": stock,
                "lot_number": lot_number,
            }
        ]
    }
    if Decimal(refund) > 0:
        payload["refund_method"] = method
    headers = {"Idempotency-Key": key} if key else None
    return await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json=payload,
        headers=headers,
    )


@pytest.mark.parametrize(
    ("refund", "stock", "method"),
    [
        ("4", "2", "CASH"),
        ("2", "0", "CARD"),
        ("2", "2", "OTHER"),
        ("0", "2", "CASH"),
        ("1", "3", "CASH"),
    ],
    ids=["refund4-stock2", "economic-only", "normal", "physical-only", "stock-above-refund"],
)
async def test_economic_and_physical_quantities_are_independent(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    refund: str,
    stock: str,
    method: str,
) -> None:
    """R1-R5/F1/F2: every valid relationship is represented explicitly."""
    await login(role_name="ADMIN")
    product, sale, _, _ = await _new_sale(client, tag=f"R-{refund}-{stock}")
    response = await _return(client, sale, refund=refund, stock=stock, method=method)

    assert response.status_code == 201, response.text
    body = response.json()
    line = body["lines"][0]
    assert Decimal(line["refund_quantity_packages"]) == Decimal(refund)
    assert Decimal(line["stock_return_quantity_packages"]) == Decimal(stock)
    assert Decimal(line["refund_amount"]) == Decimal(refund) * Decimal("2")
    if Decimal(refund) > 0:
        assert body["refund"]["amount"] == line["refund_amount"]
        assert body["refund"]["method"] == method
        assert body["refund"]["status"] == "COMPLETED"
        assert body["refund"]["completed_at"] is not None
    else:
        assert body["refund"] is None
        assert body["total_refund"] == "0"

    refreshed = (await client.get(f"/api/v1/sales/{sale['id']}")).json()["lines"][0]
    assert Decimal(refreshed["quantity_refunded"]) == Decimal(refund)
    assert Decimal(refreshed["quantity_physically_returned"]) == Decimal(stock)
    balance = (
        await client.get("/api/v1/stock-balance", params={"product_id": product["id"]})
    ).json()[0]
    assert Decimal(balance["quantity"]) == Decimal("10") + Decimal(stock)


async def test_economic_and_physical_capacities_are_bounded_independently(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
) -> None:
    """R6/R7/R8: successive legs consume only their own capacity."""
    await login(role_name="ADMIN")
    _, sale, _, _ = await _new_sale(client, tag="CAPACITY", quantity="5")

    assert (await _return(client, sale, refund="0", stock="5")).status_code == 201
    assert (await _return(client, sale, refund="5", stock="0")).status_code == 201
    economic_over = await _return(client, sale, refund="1", stock="0")
    physical_over = await _return(client, sale, refund="0", stock="1")
    assert economic_over.status_code == physical_over.status_code == 409

    refreshed = (await client.get(f"/api/v1/sales/{sale['id']}")).json()["lines"][0]
    assert refreshed["quantity_refunded"] == "5.000000"
    assert refreshed["quantity_physically_returned"] == "5.000000"


@pytest.mark.parametrize(
    ("refund", "stock", "lot_number", "expected_status"),
    [
        ("3", "1", "A8-RETURNED", 201),
        ("3", "0", None, 201),
        ("0", "2", "A8-PHYSICAL", 201),
        ("0", "2", None, 422),
    ],
    ids=["partial-physical", "economic-only", "physical-only", "physical-needs-lot"],
)
async def test_lot_is_required_only_for_the_physical_quantity(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    refund: str,
    stock: str,
    lot_number: str | None,
    expected_status: int,
) -> None:
    """R9-R11: only merchandise entering stock is assigned to a lot."""
    await login(role_name="ADMIN")
    product, sale, _, _ = await _new_sale(
        client, tag=f"LOT-{refund}-{stock}-{expected_status}", track_lots=True
    )
    response = await _return(
        client,
        sale,
        refund=refund,
        stock=stock,
        lot_number=lot_number,
    )
    assert response.status_code == expected_status, response.text
    if expected_status != 201:
        return
    line = response.json()["lines"][0]
    assert line["lot_number"] == lot_number
    movement_quantity = Decimal(0)
    if line["stock_movement_id"] is not None:
        movements = (
            await client.get("/api/v1/stock-movements", params={"product_id": product["id"]})
        ).json()
        movement = next(item for item in movements if item["id"] == line["stock_movement_id"])
        movement_quantity = Decimal(movement["quantity"])
    assert movement_quantity == Decimal(stock)


async def test_refund_uses_historical_snapshots_and_keeps_them_after_catalog_change(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    """F5/F6: neither creation nor later reads depend on today's catalogue."""
    await login(role_name="ADMIN")
    product, sale, _, _ = await _new_sale(client, tag="SNAPSHOT", quantity="3")
    await db_session.execute(
        update(Product).where(Product.id == product["id"]).values(list_price=Decimal("99"))
    )
    await db_session.flush()

    created = await _return(client, sale, refund="2", stock="0", method="CARD")
    assert created.status_code == 201
    assert created.json()["refund"]["amount"] == "4.000000"
    reread = (await client.get(f"/api/v1/returns/{created.json()['id']}")).json()
    assert reread["refund"]["amount"] == "4.000000"


async def test_client_cannot_choose_the_refund_amount(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
) -> None:
    await login(role_name="ADMIN")
    _, sale, _, _ = await _new_sale(client, tag="CLIENT-AMOUNT", quantity="2")
    response = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "refund_method": "CASH",
            "amount": "9999",
            "lines": [
                {
                    "sale_line_id": sale["lines"][0]["id"],
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "0",
                    "refund_amount": "9999",
                }
            ],
        },
    )
    assert response.status_code == 422


async def test_refund_and_audit_are_single_idempotent_effect(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    """F3: retry returns the same Return/Refund without duplicate effects."""
    actor = await login(role_name="ADMIN")
    _, sale, _, _ = await _new_sale(client, tag="IDEMPOTENT", quantity="3")
    key = "a8-a15-idempotent-refund"
    first = await _return(client, sale, refund="2", stock="1", key=key)
    replay = await _return(client, sale, refund="2", stock="1", key=key)
    assert first.status_code == replay.status_code == 201
    assert first.json()["id"] == replay.json()["id"]
    assert first.json()["refund"]["id"] == replay.json()["refund"]["id"]
    refund_id = first.json()["refund"]["id"]

    refund_count = await db_session.scalar(
        select(func.count()).select_from(Refund).where(Refund.id == refund_id)
    )
    movement_count = await db_session.scalar(
        select(func.count())
        .select_from(StockMovement)
        .where(
            StockMovement.reference_type == "return",
            StockMovement.reference_id == first.json()["id"],
        )
    )
    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.entity_type == "refund",
                AuditLog.entity_id == refund_id,
                AuditLog.action == "completed",
            )
        )
    ).scalar_one()
    assert refund_count == movement_count == 1
    assert audit.user_id == actor["id"]
    assert audit.after_data is not None
    assert audit.after_data["method"] == "CASH"


async def test_partial_refunds_use_cumulative_rounding_without_drift(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
) -> None:
    await login(role_name="ADMIN")
    product = await _create_product(
        client,
        sku="A8-ROUNDING",
        list_price="0.333333",
        tax_rate="0",
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
    parts = [await _return(client, sale, refund="1", stock="0") for _ in range(3)]
    assert all(part.status_code == 201 for part in parts)
    total = sum((Decimal(part.json()["refund"]["amount"]) for part in parts), Decimal(0))
    assert total == Decimal("0.999999")
    sale_line = await client.get(f"/api/v1/sales/{sale['id']}")
    assert sale_line.json()["lines"][0]["quantity_refunded"] == "3.000000"


async def test_refund_amount_is_the_sum_of_each_historical_sale_line(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
) -> None:
    """Several lines use their own snapshots and produce one economic effect."""
    await login(role_name="ADMIN")
    first = await _create_product(
        client,
        sku="A8-MULTI-FIRST",
        list_price="2.00",
        tax_rate="0",
    )
    second = await _create_product(
        client,
        sku="A8-MULTI-SECOND",
        list_price="3.00",
        tax_rate="0",
    )
    warehouse_id, location_id = await _default_location(client)
    for product in (first, second):
        await _stock(
            client,
            product_id=product["id"],
            warehouse_id=warehouse_id,
            location_id=location_id,
            quantity="10",
        )

    sale = (
        await client.post(
            "/api/v1/sales",
            json={"warehouse_id": warehouse_id, "location_id": location_id},
        )
    ).json()
    for product, quantity in ((first, "2"), (second, "3")):
        package_id = next(package["id"] for package in product["packages"] if package["is_base"])
        added = await client.post(
            f"/api/v1/sales/{sale['id']}/lines",
            json={
                "product_id": product["id"],
                "package_id": package_id,
                "quantity_packages": quantity,
            },
        )
        assert added.status_code == 201
        sale = added.json()
    completed = await client.post(
        f"/api/v1/sales/{sale['id']}/checkout",
        json={"payments": [{"method": "CASH", "amount": sale["total"]}]},
    )
    assert completed.status_code == 200
    lines = completed.json()["lines"]

    returned = await client.post(
        f"/api/v1/sales/{sale['id']}/returns",
        json={
            "refund_method": "CASH",
            "lines": [
                {
                    "sale_line_id": lines[0]["id"],
                    "refund_quantity_packages": "1",
                    "stock_return_quantity_packages": "0",
                },
                {
                    "sale_line_id": lines[1]["id"],
                    "refund_quantity_packages": "2",
                    "stock_return_quantity_packages": "0",
                },
            ],
        },
    )
    assert returned.status_code == 201, returned.text
    body = returned.json()
    assert [line["refund_amount"] for line in body["lines"]] == ["2.000000", "6.000000"]
    assert body["refund"]["amount"] == body["total_refund"] == "8.000000"


async def test_completed_refund_outside_the_final_z_business_day_is_not_included(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    """A13/T7: an immutable Z only includes completed effects from its own day."""
    await login(role_name="ADMIN")
    assert (
        await client.put(
            "/api/v1/settings/options",
            json={"values": {"business.timezone": "Europe/Madrid"}},
        )
    ).status_code == 200
    _, sale, warehouse_id, _ = await _new_sale(client, tag="BUSINESS-DAY", quantity="1")
    returned = await _return(client, sale, refund="1", stock="0")
    assert returned.status_code == 201
    refund_id = returned.json()["refund"]["id"]
    await db_session.execute(
        update(Refund)
        .where(Refund.id == refund_id)
        .values(completed_at=datetime(2026, 8, 12, 22, 30, tzinfo=UTC))
    )
    await db_session.flush()

    timezone = await get_business_timezone(db_session)
    day = business_date_expression(Refund.completed_at, timezone)
    grouped_day = await db_session.scalar(select(day).where(Refund.id == refund_id))
    z = await client.post("/api/v1/z-reports", params={"warehouse_id": warehouse_id})

    assert grouped_day == date(2026, 8, 13)
    assert z.status_code == 201
    assert z.json()["returns_count"] == 0
    assert z.json()["returns_total"] == "0.000000"
