"""Concurrent FEFO consumers plan only after locking current balances."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog import service as catalog_service
from app.catalog.schemas import ProductCreate
from app.core.errors import ConflictError, ValidationError
from app.inventory import service as inventory_service
from app.inventory.models import StockMovement
from app.lots import service as lots_service
from app.lots.schemas import LotCreate
from app.sales import service as sales_service
from app.sales.models import Sale, SaleStatus
from app.sales.schemas import CheckoutRequest, PaymentCreate, SaleCreate, SaleLineCreate


@dataclass(frozen=True)
class ReadyFefo:
    product_id: int
    package_id: int
    warehouse_id: int
    location_id: int
    first_lot_id: int
    second_lot_id: int | None


async def _ready_fefo(
    maker: async_sessionmaker[AsyncSession],
    *,
    tag: str,
    first_quantity: Decimal = Decimal("5"),
    second_quantity: Decimal | None = Decimal("10"),
    same_expiry: bool = False,
) -> ReadyFefo:
    async with maker() as session:
        product = await catalog_service.create_product(
            session,
            ProductCreate(
                sku=f"FEFO-CONCURRENCY-{tag}",
                name=f"FEFO concurrency {tag}",
                base_unit_name="UNIDAD",
                cost=Decimal("1"),
                list_price=Decimal("1"),
                tax_rate=Decimal("0"),
                track_lots=True,
                track_expiration=True,
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
        first_lot = await lots_service.create_lot(
            session,
            LotCreate(
                product_id=product.id,
                lot_number=f"{tag}-FIRST",
                expiration_date=date(2026, 9, 1),
            ),
        )
        second_lot = None
        if second_quantity is not None:
            second_lot = await lots_service.create_lot(
                session,
                LotCreate(
                    product_id=product.id,
                    lot_number=f"{tag}-SECOND",
                    expiration_date=date(2026, 9, 1) if same_expiry else date(2026, 12, 1),
                ),
            )
        await inventory_service.record_movement(
            session,
            product_id=product.id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            lot_id=first_lot.id,
            quantity=first_quantity,
            movement_type="ADJUSTMENT",
            unit_cost=Decimal("1"),
        )
        if second_lot is not None and second_quantity is not None:
            await inventory_service.record_movement(
                session,
                product_id=product.id,
                warehouse_id=warehouse.id,
                location_id=location.id,
                lot_id=second_lot.id,
                quantity=second_quantity,
                movement_type="ADJUSTMENT",
                unit_cost=Decimal("1"),
            )
        await session.commit()
        return ReadyFefo(
            product_id=product.id,
            package_id=product.packages[0].id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            first_lot_id=first_lot.id,
            second_lot_id=second_lot.id if second_lot is not None else None,
        )


async def test_two_fefo_consumers_replan_after_waiting_for_the_first_lot(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_fefo(committing_sessionmaker, tag="F1")

    async def consume(reference_id: int) -> list[tuple[int, Decimal]]:
        async with committing_sessionmaker() as session:
            allocations = await lots_service.execute_fefo_consumption(
                session,
                product_id=ready.product_id,
                warehouse_id=ready.warehouse_id,
                location_id=ready.location_id,
                quantity=Decimal("5"),
                movement_type="WASTE",
                unit_cost=Decimal("1"),
                reference_type="fefo_concurrency",
                reference_id=reference_id,
            )
            await session.commit()
            return [(allocation.lot.id, allocation.quantity) for allocation in allocations]

    results = await asyncio.gather(consume(1), consume(2))
    assert ready.second_lot_id is not None
    assert sorted(allocation for result in results for allocation in result) == sorted(
        [(ready.first_lot_id, Decimal("5")), (ready.second_lot_id, Decimal("5"))]
    )


async def test_concurrent_lot_checkouts_both_complete_when_total_stock_is_sufficient(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_fefo(committing_sessionmaker, tag="F1-SALES")
    async with committing_sessionmaker() as session:
        sale_ids: list[int] = []
        for _ in range(2):
            sale = await sales_service.create_sale(
                session,
                SaleCreate(warehouse_id=ready.warehouse_id, location_id=ready.location_id),
            )
            await sales_service.add_line(
                session,
                sale.id,
                SaleLineCreate(
                    product_id=ready.product_id,
                    package_id=ready.package_id,
                    quantity_packages=Decimal("5"),
                ),
            )
            sale_ids.append(sale.id)
        await session.commit()

    async def checkout(sale_id: int) -> str:
        async with committing_sessionmaker() as session:
            sale = await sales_service.checkout(
                session,
                sale_id,
                CheckoutRequest(payments=[PaymentCreate(method="CASH", amount=Decimal("5"))]),
            )
            await session.commit()
            return sale.status

    statuses = await asyncio.gather(*(checkout(sale_id) for sale_id in sale_ids))
    assert statuses == [SaleStatus.COMPLETED, SaleStatus.COMPLETED]
    async with committing_sessionmaker() as session:
        balances = await inventory_service.list_balances(
            session, product_id=ready.product_id, warehouse_id=ready.warehouse_id
        )
    assert sum((balance.quantity for balance in balances), Decimal(0)) == Decimal("5")


async def test_concurrent_fefo_checkouts_only_one_succeeds_when_stock_is_exhausted(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_fefo(
        committing_sessionmaker,
        tag="F2",
        first_quantity=Decimal("5"),
        second_quantity=None,
    )
    async with committing_sessionmaker() as session:
        sale_ids: list[int] = []
        for _ in range(2):
            sale = await sales_service.create_sale(
                session,
                SaleCreate(warehouse_id=ready.warehouse_id, location_id=ready.location_id),
            )
            await sales_service.add_line(
                session,
                sale.id,
                SaleLineCreate(
                    product_id=ready.product_id,
                    package_id=ready.package_id,
                    quantity_packages=Decimal("5"),
                ),
            )
            sale_ids.append(sale.id)
        await session.commit()

    async def checkout(sale_id: int) -> str:
        async with committing_sessionmaker() as session:
            try:
                await sales_service.checkout(
                    session,
                    sale_id,
                    CheckoutRequest(payments=[PaymentCreate(method="CASH", amount=Decimal("5"))]),
                )
                await session.commit()
                return "success"
            except (ConflictError, ValidationError):
                await session.rollback()
                return "insufficient"

    outcomes = await asyncio.gather(*(checkout(sale_id) for sale_id in sale_ids))
    assert sorted(outcomes) == ["insufficient", "success"]
    async with committing_sessionmaker() as session:
        balances = await inventory_service.list_balances(
            session, product_id=ready.product_id, warehouse_id=ready.warehouse_id
        )
        completed_sales = await session.scalar(
            select(func.count())
            .select_from(Sale)
            .where(Sale.id.in_(sale_ids), Sale.status == SaleStatus.COMPLETED)
        )
    assert sum((balance.quantity for balance in balances), Decimal(0)) == Decimal("0")
    assert completed_sales == 1


async def test_fefo_tie_breaks_equal_expiry_dates_by_lot_id(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_fefo(committing_sessionmaker, tag="F3", same_expiry=True)
    async with committing_sessionmaker() as session:
        allocations = await lots_service.plan_fefo(
            session,
            product_id=ready.product_id,
            warehouse_id=ready.warehouse_id,
            location_id=ready.location_id,
            quantity=Decimal("5"),
        )
    assert [allocation.lot.id for allocation in allocations] == [ready.first_lot_id]


async def test_failed_fefo_consumer_leaves_no_partial_movements(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_fefo(
        committing_sessionmaker,
        tag="F2-ROLLBACK",
        first_quantity=Decimal("2"),
        second_quantity=Decimal("2"),
    )
    async with committing_sessionmaker() as session:
        with pytest.raises(ValidationError):
            await lots_service.execute_fefo_consumption(
                session,
                product_id=ready.product_id,
                warehouse_id=ready.warehouse_id,
                location_id=ready.location_id,
                quantity=Decimal("5"),
                movement_type="WASTE",
                unit_cost=Decimal("1"),
                reference_type="fefo_failed",
                reference_id=1,
            )
        await session.rollback()
    async with committing_sessionmaker() as session:
        movement_count = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(
                StockMovement.product_id == ready.product_id,
                StockMovement.reference_type == "fefo_failed",
            )
        )
    assert movement_count == 0
