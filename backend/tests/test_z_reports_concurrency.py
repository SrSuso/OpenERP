"""PostgreSQL serialization and idempotency guarantees for Z reports."""

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
from app.returns.models import Return
from app.returns.schemas import ReturnCreate, ReturnLineCreate
from app.sales import accounting, z_reports
from app.sales import service as sales_service
from app.sales.models import Payment, PaymentMethod, Sale, ZReport
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


def _return_payload(ready: ReadyZ, quantity: str = "1") -> ReturnCreate:
    assert ready.sale_line_id is not None
    return ReturnCreate(
        lines=[
            ReturnLineCreate(
                sale_line_id=ready.sale_line_id,
                refund_quantity_packages=Decimal(quantity),
                stock_return_quantity_packages=Decimal(0),
            )
        ],
        refund_method=PaymentMethod.CASH,
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


async def test_checkout_wins_and_is_included_once_with_its_payment(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Z1/Z9/Z12: checkout commits before the cut, which then includes it."""
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


async def test_z_wins_and_a_later_checkout_does_not_open_a_second_daily_z(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """La Z diaria queda congelada aunque se intente cerrarla otra vez."""
    ready = await _ready_z(committing_sessionmaker, tag="Z-FIRST", with_line=False)
    line_added = asyncio.Event()

    async def waiting_checkout() -> Sale:
        async with committing_sessionmaker() as session:
            await sales_service.add_line(
                session,
                ready.sale_id,
                SaleLineCreate(
                    product_id=ready.product_id,
                    package_id=ready.package_id,
                    quantity_packages=Decimal("1"),
                ),
            )
            line_added.set()
            sale = await sales_service.checkout(
                session,
                ready.sale_id,
                _checkout_payload(),
                idempotency_key="checkout-after-z",
                actor_user_id=ready.actor_user_id,
            )
            await session.commit()
            return sale

    async with committing_sessionmaker() as close_session:
        await accounting.lock_warehouse_cut(close_session, ready.warehouse_id)
        checkout_task = asyncio.create_task(waiting_checkout())
        await asyncio.wait_for(line_added.wait(), timeout=10)
        first = await z_reports.close(
            close_session,
            ready.warehouse_id,
            idempotency_key="z-before-checkout",
            actor_user_id=ready.actor_user_id,
        )
        await close_session.commit()

    completed = await asyncio.wait_for(checkout_task, timeout=10)
    second = await _close(committing_sessionmaker, ready, "z-after-checkout")
    assert first.sales_count == 0
    assert completed.completed_at is not None and completed.completed_at > first.closed_at
    assert second.id == first.id
    assert second.sales_count == 0
    assert second.cash_total == Decimal(0)


async def test_return_after_a_daily_z_does_not_open_another_z(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Una devolución posterior no convierte la reimpresión en otro cierre."""
    ready = await _ready_z(committing_sessionmaker, tag="RETURN-FIRST", completed=True)
    first = await _close(committing_sessionmaker, ready, "z-before-return")
    close_started = asyncio.Event()

    async def waiting_close() -> ZReport:
        close_started.set()
        return await _close(committing_sessionmaker, ready, "z-after-return")

    async with committing_sessionmaker() as return_session:
        await accounting.lock_warehouse_cut(return_session, ready.warehouse_id)
        close_task = asyncio.create_task(waiting_close())
        await asyncio.wait_for(close_started.wait(), timeout=10)
        returned = await returns_service.create_return(
            return_session,
            ready.sale_id,
            _return_payload(ready),
            idempotency_key="return-before-z",
            actor_user_id=ready.actor_user_id,
        )
        await return_session.commit()

    report = await asyncio.wait_for(close_task, timeout=10)
    assert returned.refund is not None
    assert returned.refund.completed_at > first.closed_at
    assert report.id == first.id
    assert report.returns_count == 0
    assert report.returns_total == Decimal(0)


async def test_z_wins_and_waiting_return_does_not_create_a_second_daily_z(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Z4: transaction-start time cannot date a waiting return backwards."""
    ready = await _ready_z(committing_sessionmaker, tag="Z-BEFORE-RETURN", completed=True)
    await _close(committing_sessionmaker, ready, "z-return-baseline")
    return_started = asyncio.Event()

    async def waiting_return() -> Return:
        async with committing_sessionmaker() as session:
            await session.execute(text("SELECT 1"))  # start transaction before the Z cut
            return_started.set()
            returned = await returns_service.create_return(
                session,
                ready.sale_id,
                _return_payload(ready),
                idempotency_key="return-after-z",
                actor_user_id=ready.actor_user_id,
            )
            await session.commit()
            return returned

    async with committing_sessionmaker() as close_session:
        await accounting.lock_warehouse_cut(close_session, ready.warehouse_id)
        return_task = asyncio.create_task(waiting_return())
        await asyncio.wait_for(return_started.wait(), timeout=10)
        current = await z_reports.close(
            close_session,
            ready.warehouse_id,
            idempotency_key="z-before-waiting-return",
            actor_user_id=ready.actor_user_id,
        )
        await close_session.commit()

    returned = await asyncio.wait_for(return_task, timeout=10)
    repeated = await _close(committing_sessionmaker, ready, "z-after-waiting-return")
    assert current.returns_count == 0
    assert returned.refund is not None
    assert returned.refund.completed_at > current.closed_at
    assert repeated.id == current.id
    assert repeated.returns_count == 0
    assert repeated.returns_total == Decimal(0)


async def test_two_different_close_keys_return_the_same_daily_z(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Dos pulsaciones no pueden crear dos Z aunque usen claves distintas."""
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
    assert [outcome for outcome, _report_id in outcomes] == ["success", "success"]
    assert outcomes[0][1] == outcomes[1][1]
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
                AuditLog.action == "closed",
            )
        )
    assert report_count == audit_count == 1


async def test_same_close_key_replays_sequentially_with_one_audit(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Z6/Z16: replay returns the same report and records success once."""
    ready = await _ready_z(committing_sessionmaker, tag="Z-REPLAY", completed=True)
    first = await _close(committing_sessionmaker, ready, "same-z-key")
    replay = await _close(committing_sessionmaker, ready, "same-z-key")
    assert replay.id == first.id

    async with committing_sessionmaker() as session:
        report_count = await session.scalar(
            select(func.count())
            .select_from(ZReport)
            .where(ZReport.warehouse_id == ready.warehouse_id)
        )
        audit_count = await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.entity_type == "z_report",
                AuditLog.entity_id == first.id,
                AuditLog.action == "closed",
            )
        )
    assert report_count == audit_count == 1


async def test_same_close_key_serializes_concurrent_retries(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Z7: the idempotency row serializes uncertain concurrent retries."""
    ready = await _ready_z(committing_sessionmaker, tag="Z-SAME-CONCURRENT", completed=True)
    reports = await asyncio.wait_for(
        asyncio.gather(
            _close(committing_sessionmaker, ready, "same-concurrent-z"),
            _close(committing_sessionmaker, ready, "same-concurrent-z"),
        ),
        timeout=10,
    )
    assert reports[0].id == reports[1].id
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


async def test_same_close_key_cannot_be_reused_for_another_warehouse(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Z8: warehouse id is the complete current close intention."""
    first = await _ready_z(committing_sessionmaker, tag="Z-KEY-WAREHOUSE-A", with_line=False)
    second = await _ready_z(committing_sessionmaker, tag="Z-KEY-WAREHOUSE-B", with_line=False)
    key = "same-key-different-z-scope"
    await _close(committing_sessionmaker, first, key)
    with pytest.raises(ConflictError):
        await _close(committing_sessionmaker, second, key)


async def test_a_warehouse_cut_does_not_block_another_warehouse(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    first = await _ready_z(committing_sessionmaker, tag="Z-SCOPE-A", with_line=False)
    second = await _ready_z(committing_sessionmaker, tag="Z-SCOPE-B", with_line=False)

    async with committing_sessionmaker() as first_session:
        await accounting.lock_warehouse_cut(first_session, first.warehouse_id)
        other_report = await asyncio.wait_for(
            _close(committing_sessionmaker, second, "independent-z-scope"), timeout=10
        )
        await first_session.rollback()

    assert other_report.warehouse_id == second.warehouse_id


async def test_operations_after_the_daily_z_do_not_create_a_second_cut(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """La reimpresión mantiene intactos los totales de la única Z diaria."""
    ready = await _ready_z(committing_sessionmaker, tag="TWO-CUTS", completed=True, quantity="2")
    async with committing_sessionmaker() as session:
        first_return = await returns_service.create_return(
            session,
            ready.sale_id,
            _return_payload(ready),
            idempotency_key="return-in-first-cut",
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()

    first = await _close(committing_sessionmaker, ready, "first-partition-cut")

    async with committing_sessionmaker() as session:
        second_return = await returns_service.create_return(
            session,
            ready.sale_id,
            _return_payload(ready),
            idempotency_key="return-in-second-cut",
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()

    second = await _close(committing_sessionmaker, ready, "second-partition-cut")
    assert first.sales_count == 1
    assert second.id == first.id
    assert first.returns_count == second.returns_count == 1
    assert first_return.created_at <= first.closed_at < second_return.created_at
