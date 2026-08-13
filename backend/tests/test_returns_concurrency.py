"""PostgreSQL concurrency/idempotency guarantees for returns."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog import service as catalog_service
from app.catalog.schemas import ProductCreate
from app.core.errors import ConflictError
from app.inventory import service as inventory_service
from app.inventory.models import StockMovement
from app.rbac.models import Role
from app.returns import service as returns_service
from app.returns.models import Refund, Return, ReturnLine
from app.returns.schemas import ReturnCreate, ReturnLineCreate
from app.sales import service as sales_service
from app.sales.models import PaymentMethod, SaleLine
from app.sales.schemas import CheckoutRequest, PaymentCreate, SaleCreate, SaleLineCreate
from app.users.models import User


@dataclass(frozen=True)
class ReadyReturn:
    sale_id: int
    sale_line_id: int
    product_id: int
    warehouse_id: int
    location_id: int
    actor_user_id: int


async def _ready_return(
    maker: async_sessionmaker[AsyncSession],
    *,
    tag: str,
    quantity: Decimal = Decimal("5"),
) -> ReadyReturn:
    async with maker() as session:
        manager_role = (
            await session.execute(select(Role).where(Role.name == "MANAGER"))
        ).scalar_one()
        actor = User(
            email=f"return-concurrency-{tag.lower()}@example.com",
            full_name=f"Return concurrency {tag}",
            password_hash="unused",
            role_id=manager_role.id,
        )
        session.add(actor)
        await session.flush()
        product = await catalog_service.create_product(
            session,
            ProductCreate(
                sku=f"RETURN-CONCURRENCY-{tag}",
                name=f"Return concurrency {tag}",
                base_unit_name="UNIDAD",
                cost=Decimal("1"),
                list_price=Decimal("2"),
                tax_rate=Decimal("0"),
            ),
        )
        warehouse = next(
            item
            for item in await inventory_service.list_warehouses(session)
            if item.name == "Tienda principal"
        )
        location = next(
            item
            for item in await inventory_service.list_locations(session, warehouse.id)
            if item.name == "Almacén"
        )
        await inventory_service.record_movement(
            session,
            product_id=product.id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            quantity=Decimal("10"),
            movement_type="ADJUSTMENT",
            unit_cost=Decimal("1"),
        )
        sale = await sales_service.create_sale(
            session, SaleCreate(warehouse_id=warehouse.id, location_id=location.id)
        )
        sale = await sales_service.add_line(
            session,
            sale.id,
            SaleLineCreate(
                product_id=product.id,
                package_id=product.packages[0].id,
                quantity_packages=quantity,
            ),
        )
        sale_line_id = sale.lines[0].id
        await sales_service.checkout(
            session,
            sale.id,
            CheckoutRequest(
                payments=[PaymentCreate(method="CASH", amount=quantity * Decimal("2"))]
            ),
        )
        await session.commit()
        return ReadyReturn(
            sale_id=sale.id,
            sale_line_id=sale_line_id,
            product_id=product.id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            actor_user_id=actor.id,
        )


def _return_payload(
    ready: ReadyReturn,
    refund_quantity: str,
    *,
    stock_quantity: str | None = None,
) -> ReturnCreate:
    refund = Decimal(refund_quantity)
    stock = refund if stock_quantity is None else Decimal(stock_quantity)
    return ReturnCreate(
        lines=[
            ReturnLineCreate(
                sale_line_id=ready.sale_line_id,
                refund_quantity_packages=refund,
                stock_return_quantity_packages=stock,
            )
        ],
        refund_method=PaymentMethod.CASH if refund > 0 else None,
    )


def test_return_fingerprint_normalizes_decimal_and_line_order() -> None:
    left = ReturnCreate(
        notes="same",
        lines=[
            ReturnLineCreate(
                sale_line_id=20,
                refund_quantity_packages=Decimal("2.0"),
                stock_return_quantity_packages=Decimal(0),
                lot_number="IGNORED-FOR-ECONOMIC-ONLY",
            ),
            ReturnLineCreate(
                sale_line_id=10,
                refund_quantity_packages=Decimal(0),
                stock_return_quantity_packages=Decimal("1"),
            ),
        ],
        refund_method=PaymentMethod.CASH,
    )
    right = ReturnCreate(
        notes="same",
        lines=[
            ReturnLineCreate(
                sale_line_id=10,
                refund_quantity_packages=Decimal(0),
                stock_return_quantity_packages=Decimal("1.000000"),
            ),
            ReturnLineCreate(
                sale_line_id=20,
                refund_quantity_packages=Decimal("2"),
                stock_return_quantity_packages=Decimal(0),
            ),
        ],
        refund_method=PaymentMethod.CASH,
    )

    assert returns_service.return_request_fingerprint(
        7, left
    ) == returns_service.return_request_fingerprint(7, right)


@pytest.mark.parametrize(
    ("refund_quantity", "stock_quantity"),
    [("4", "0"), ("0", "4")],
    ids=["economic-capacity", "physical-capacity"],
)
async def test_concurrent_returns_cannot_exceed_each_independent_capacity(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
    refund_quantity: str,
    stock_quantity: str,
) -> None:
    dimension = "ECONOMIC" if Decimal(refund_quantity) > 0 else "PHYSICAL"
    ready = await _ready_return(committing_sessionmaker, tag=f"D1-{dimension}")

    async def attempt(key: str) -> str:
        async with committing_sessionmaker() as session:
            try:
                await returns_service.create_return(
                    session,
                    ready.sale_id,
                    _return_payload(
                        ready,
                        refund_quantity,
                        stock_quantity=stock_quantity,
                    ),
                    idempotency_key=key,
                    actor_user_id=ready.actor_user_id,
                )
                await session.commit()
                return "success"
            except ConflictError:
                await session.rollback()
                return "conflict"

    outcomes = await asyncio.gather(attempt("return-d1-a"), attempt("return-d1-b"))
    assert sorted(outcomes) == ["conflict", "success"]
    async with committing_sessionmaker() as session:
        sale_line = await session.get(SaleLine, ready.sale_line_id)
        return_count = await session.scalar(
            select(func.count()).select_from(Return).where(Return.sale_id == ready.sale_id)
        )
    assert sale_line is not None
    assert sale_line.quantity_refunded == Decimal(refund_quantity)
    assert sale_line.quantity_physically_returned == Decimal(stock_quantity)
    assert return_count == 1


async def test_return_same_key_replays_sequentially(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_return(committing_sessionmaker, tag="D2")
    payload = _return_payload(ready, "2")
    key = "return-d2-replay"
    async with committing_sessionmaker() as session:
        first = await returns_service.create_return(
            session,
            ready.sale_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
        first_id = first.id
    async with committing_sessionmaker() as session:
        replay = await returns_service.create_return(
            session,
            ready.sale_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
    assert replay.id == first_id


async def test_physical_only_return_retry_restocks_once_without_a_refund(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_return(committing_sessionmaker, tag="D2-PHYSICAL")
    payload = _return_payload(ready, "0", stock_quantity="2")
    key = "return-d2-physical-replay"
    async with committing_sessionmaker() as session:
        first = await returns_service.create_return(
            session,
            ready.sale_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
        first_id = first.id
    async with committing_sessionmaker() as session:
        replay = await returns_service.create_return(
            session,
            ready.sale_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()

    assert replay.id == first_id
    async with committing_sessionmaker() as session:
        refund_count = await session.scalar(
            select(func.count()).select_from(Refund).where(Refund.return_id == first_id)
        )
        movement_count = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(
                StockMovement.reference_type == "return",
                StockMovement.reference_id == first_id,
            )
        )
        line = await session.get(SaleLine, ready.sale_line_id)
    assert refund_count == 0
    assert movement_count == 1
    assert line is not None
    assert line.quantity_refunded == 0
    assert line.quantity_physically_returned == Decimal("2")


async def test_return_same_key_serializes_concurrent_requests(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_return(committing_sessionmaker, tag="D3")
    payload = _return_payload(ready, "2")
    key = "return-d3-concurrent"

    async def attempt() -> int:
        async with committing_sessionmaker() as session:
            ret = await returns_service.create_return(
                session,
                ready.sale_id,
                payload,
                idempotency_key=key,
                actor_user_id=ready.actor_user_id,
            )
            await session.commit()
            return ret.id

    return_ids = await asyncio.gather(attempt(), attempt())
    assert return_ids[0] == return_ids[1]
    async with committing_sessionmaker() as session:
        return_count = await session.scalar(
            select(func.count()).select_from(Return).where(Return.sale_id == ready.sale_id)
        )
    assert return_count == 1


async def test_return_same_key_rejects_a_different_payload(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_return(committing_sessionmaker, tag="D4")
    key = "return-d4-mismatch"
    async with committing_sessionmaker() as session:
        await returns_service.create_return(
            session,
            ready.sale_id,
            _return_payload(ready, "1"),
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
    async with committing_sessionmaker() as session:
        with pytest.raises(ConflictError):
            await returns_service.create_return(
                session,
                ready.sale_id,
                _return_payload(ready, "2"),
                idempotency_key=key,
                actor_user_id=ready.actor_user_id,
            )
        await session.rollback()


async def test_physical_and_economic_return_retry_applies_each_effect_once(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_return(committing_sessionmaker, tag="D5-D6")
    payload = _return_payload(ready, "2")
    key = "return-d5-d6-effects"
    async with committing_sessionmaker() as session:
        first = await returns_service.create_return(
            session,
            ready.sale_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
        first_id = first.id
    async with committing_sessionmaker() as session:
        replay = await returns_service.create_return(
            session,
            ready.sale_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
    assert replay.id == first_id

    async with committing_sessionmaker() as session:
        lines = list(
            (
                await session.execute(select(ReturnLine).where(ReturnLine.return_id == first_id))
            ).scalars()
        )
        movement_count = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(
                StockMovement.reference_type == "return",
                StockMovement.reference_id == first_id,
            )
        )
        balances = await inventory_service.list_balances(
            session, product_id=ready.product_id, warehouse_id=ready.warehouse_id
        )
        sale_line = await session.get(SaleLine, ready.sale_line_id)
    assert len(lines) == 1
    assert lines[0].refund_amount == Decimal("4")
    assert movement_count == 1
    assert balances[0].quantity == Decimal("7")  # 10 - 5 sold + 2 returned once
    assert sale_line is not None
    assert sale_line.quantity_refunded == Decimal("2")
    assert sale_line.quantity_physically_returned == Decimal("2")


async def test_full_economic_and_full_physical_returns_can_both_succeed_concurrently(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Independent capacities: each transaction may consume all of its leg."""
    ready = await _ready_return(committing_sessionmaker, tag="D7-INDEPENDENT")

    async def attempt(payload: ReturnCreate, key: str) -> int:
        async with committing_sessionmaker() as session:
            ret = await returns_service.create_return(
                session,
                ready.sale_id,
                payload,
                idempotency_key=key,
                actor_user_id=ready.actor_user_id,
            )
            await session.commit()
            return ret.id

    ids = await asyncio.gather(
        attempt(_return_payload(ready, "5", stock_quantity="0"), "return-d7-economic"),
        attempt(_return_payload(ready, "0", stock_quantity="5"), "return-d7-physical"),
    )
    assert ids[0] != ids[1]

    async with committing_sessionmaker() as session:
        sale_line = await session.get(SaleLine, ready.sale_line_id)
        refund_count = await session.scalar(
            select(func.count()).select_from(Refund).where(Refund.return_id.in_(ids))
        )
        return_count = await session.scalar(
            select(func.count()).select_from(Return).where(Return.sale_id == ready.sale_id)
        )
    assert sale_line is not None
    assert sale_line.quantity_refunded == Decimal("5")
    assert sale_line.quantity_physically_returned == Decimal("5")
    assert refund_count == 1
    assert return_count == 2
