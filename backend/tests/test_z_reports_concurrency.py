"""Serialization and idempotency guarantees for final Z reports."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.audit.models import AuditLog
from app.catalog import service as catalog_service
from app.catalog.schemas import ProductCreate
from app.core.errors import ConflictError
from app.idempotency.models import IdempotencyRecord
from app.inventory import service as inventory_service
from app.rbac.models import Role
from app.returns import service as returns_service
from app.returns.schemas import ReturnCreate, ReturnLineCreate
from app.sales import accounting, z_reports
from app.sales import service as sales_service
from app.sales.models import Payment, ZReport
from app.sales.schemas import CheckoutRequest, PaymentCreate, SaleCreate, SaleLineCreate
from app.users.models import User


@dataclass(frozen=True)
class ReadyZ:
    sale_id: int
    sale_line_id: int | None
    product_id: int
    package_id: int
    warehouse_id: int
    location_id: int
    actor_user_id: int


async def _ready_z(
    maker: async_sessionmaker[AsyncSession],
    *,
    tag: str,
    with_line: bool = True,
    completed: bool = False,
    quantity: str = "1",
) -> ReadyZ:
    async with maker() as session:
        cashier_role = (
            await session.execute(select(Role).where(Role.name == "CASHIER"))
        ).scalar_one()
        actor = User(
            email=f"z-concurrency-{tag.lower()}@example.com",
            full_name=f"Z concurrency {tag}",
            password_hash="unused",
            role_id=cashier_role.id,
        )
        session.add(actor)
        warehouse = await inventory_service.create_warehouse(session, f"Z concurrency {tag}")
        location = await inventory_service.create_location(session, warehouse.id, "Till")
        product = await catalog_service.create_product(
            session,
            ProductCreate(
                sku=f"Z-CONCURRENCY-{tag}",
                name=f"Z concurrency {tag}",
                base_unit_name="UNIDAD",
                cost=Decimal("1"),
                list_price=Decimal("5"),
                tracks_stock=False,
            ),
        )
        package_id = product.packages[0].id
        sale = await sales_service.create_sale(
            session, SaleCreate(warehouse_id=warehouse.id, location_id=location.id)
        )
        sale_line_id = None
        if with_line:
            sale = await sales_service.add_line(
                session,
                sale.id,
                SaleLineCreate(
                    product_id=product.id,
                    package_id=package_id,
                    quantity_packages=Decimal(quantity),
                ),
            )
            sale_line_id = sale.lines[0].id
        if completed:
            await sales_service.checkout(
                session,
                sale.id,
                _checkout_payload(str(Decimal(quantity) * Decimal("5"))),
                actor_user_id=actor.id,
            )
        await session.commit()
        return ReadyZ(
            sale_id=sale.id,
            sale_line_id=sale_line_id,
            product_id=product.id,
            package_id=package_id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            actor_user_id=actor.id,
        )


def _checkout_payload(amount: str = "5") -> CheckoutRequest:
    return CheckoutRequest(payments=[PaymentCreate(method="CASH", amount=Decimal(amount))])


def _economic_return_payload(ready: ReadyZ) -> ReturnCreate:
    assert ready.sale_line_id is not None
    return ReturnCreate(
        lines=[
            ReturnLineCreate(
                sale_line_id=ready.sale_line_id,
                refund_quantity_packages=Decimal(1),
                stock_return_quantity_packages=Decimal(0),
            )
        ],
        refund_method="CASH",
    )


async def _close(maker: async_sessionmaker[AsyncSession], ready: ReadyZ, key: str) -> ZReport:
    async with maker() as session:
        report = await z_reports.close(
            session,
            ready.warehouse_id,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
        return report


async def test_checkout_before_the_cut_is_included_once_with_its_payment(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_z(committing_sessionmaker, tag="CHECKOUT-FIRST")
    close_started = asyncio.Event()

    async def waiting_close() -> ZReport:
        close_started.set()
        return await _close(committing_sessionmaker, ready, "z-checkout-first")

    async with committing_sessionmaker() as checkout_session:
        await accounting.lock_warehouse_cut(checkout_session, ready.warehouse_id)
        close_task = asyncio.create_task(waiting_close())
        await asyncio.wait_for(close_started.wait(), timeout=10)
        completed = await sales_service.checkout(
            checkout_session,
            ready.sale_id,
            _checkout_payload(),
            idempotency_key="checkout-before-z",
            actor_user_id=ready.actor_user_id,
        )
        await checkout_session.commit()

    report = await asyncio.wait_for(close_task, timeout=10)
    assert completed.completed_at is not None and completed.completed_at <= report.closed_at
    assert report.sales_count == 1
    assert report.gross_total == report.cash_total == Decimal("5")
    async with committing_sessionmaker() as session:
        payment_count = await session.scalar(
            select(func.count()).select_from(Payment).where(Payment.sale_id == ready.sale_id)
        )
    assert payment_count == 1


async def test_final_z_before_checkout_rejects_the_waiting_checkout(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_z(committing_sessionmaker, tag="Z-FIRST", with_line=False)
    line_added = asyncio.Event()

    async def waiting_checkout() -> None:
        async with committing_sessionmaker() as session:
            await sales_service.add_line(
                session,
                ready.sale_id,
                SaleLineCreate(
                    product_id=ready.product_id,
                    package_id=ready.package_id,
                    quantity_packages=Decimal(1),
                ),
            )
            line_added.set()
            await sales_service.checkout(
                session,
                ready.sale_id,
                _checkout_payload(),
                idempotency_key="checkout-after-z",
                actor_user_id=ready.actor_user_id,
            )
            await session.commit()

    async with committing_sessionmaker() as close_session:
        await accounting.lock_warehouse_cut(close_session, ready.warehouse_id)
        checkout_task = asyncio.create_task(waiting_checkout())
        await asyncio.wait_for(line_added.wait(), timeout=10)
        report = await z_reports.close(
            close_session,
            ready.warehouse_id,
            idempotency_key="z-before-checkout",
            actor_user_id=ready.actor_user_id,
        )
        await close_session.commit()

    with pytest.raises(ConflictError, match="Z definitiva"):
        await asyncio.wait_for(checkout_task, timeout=10)
    assert report.sales_count == 0


async def test_final_z_rejects_a_waiting_economic_return(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_z(committing_sessionmaker, tag="Z-RETURN", completed=True)
    return_started = asyncio.Event()

    async def waiting_return() -> None:
        async with committing_sessionmaker() as session:
            await session.execute(text("SELECT 1"))
            return_started.set()
            await returns_service.create_return(
                session,
                ready.sale_id,
                _economic_return_payload(ready),
                idempotency_key="return-after-z",
                actor_user_id=ready.actor_user_id,
            )
            await session.commit()

    async with committing_sessionmaker() as close_session:
        await accounting.lock_warehouse_cut(close_session, ready.warehouse_id)
        return_task = asyncio.create_task(waiting_return())
        await asyncio.wait_for(return_started.wait(), timeout=10)
        report = await z_reports.close(
            close_session,
            ready.warehouse_id,
            idempotency_key="z-before-return",
            actor_user_id=ready.actor_user_id,
        )
        await close_session.commit()

    with pytest.raises(ConflictError, match="Z definitiva"):
        await asyncio.wait_for(return_task, timeout=10)
    assert report.returns_count == 0


async def test_different_close_keys_produce_one_final_z(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ready = await _ready_z(committing_sessionmaker, tag="DIFFERENT-CLOSE-KEYS", completed=True)
    original_lock = accounting.lock_warehouse_cut
    both_observed = asyncio.Event()
    arrivals = 0

    async def barrier_lock(session: AsyncSession, warehouse_id: int) -> None:
        nonlocal arrivals
        arrivals += 1
        if arrivals == 2:
            both_observed.set()
        await asyncio.wait_for(both_observed.wait(), timeout=10)
        await original_lock(session, warehouse_id)

    monkeypatch.setattr(accounting, "lock_warehouse_cut", barrier_lock)

    async def attempt(key: str) -> tuple[str, int | None]:
        try:
            report = await _close(committing_sessionmaker, ready, key)
            return "success", report.id
        except ConflictError:
            return "conflict", None

    outcomes = await asyncio.wait_for(
        asyncio.gather(attempt("z-different-a"), attempt("z-different-b")), timeout=10
    )
    assert sorted(outcome for outcome, _report_id in outcomes) == ["conflict", "success"]
    async with committing_sessionmaker() as session:
        report_count = await session.scalar(
            select(func.count())
            .select_from(ZReport)
            .where(ZReport.warehouse_id == ready.warehouse_id)
        )
        audit_count = await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .join(ZReport, ZReport.id == AuditLog.entity_id)
            .where(
                ZReport.warehouse_id == ready.warehouse_id,
                AuditLog.entity_type == "z_report",
                AuditLog.action == "finalized",
            )
        )
    assert report_count == audit_count == 1


async def test_same_close_key_replays_and_serializes_concurrent_retries(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_z(committing_sessionmaker, tag="SAME-KEY", completed=True)
    reports = await asyncio.wait_for(
        asyncio.gather(
            _close(committing_sessionmaker, ready, "same-concurrent-z"),
            _close(committing_sessionmaker, ready, "same-concurrent-z"),
        ),
        timeout=10,
    )
    replay = await _close(committing_sessionmaker, ready, "same-concurrent-z")
    assert reports[0].id == reports[1].id == replay.id
    async with committing_sessionmaker() as session:
        report_count = await session.scalar(
            select(func.count())
            .select_from(ZReport)
            .where(ZReport.warehouse_id == ready.warehouse_id)
        )
        key_count = await session.scalar(
            select(func.count())
            .select_from(IdempotencyRecord)
            .where(
                IdempotencyRecord.operation == "z_report.close",
                IdempotencyRecord.idempotency_key == "same-concurrent-z",
            )
        )
    assert report_count == key_count == 1


async def test_close_key_cannot_be_reused_for_another_warehouse(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    first = await _ready_z(committing_sessionmaker, tag="KEY-WAREHOUSE-A", with_line=False)
    second = await _ready_z(committing_sessionmaker, tag="KEY-WAREHOUSE-B", with_line=False)
    await _close(committing_sessionmaker, first, "same-key-different-z-scope")
    with pytest.raises(ConflictError):
        await _close(committing_sessionmaker, second, "same-key-different-z-scope")
