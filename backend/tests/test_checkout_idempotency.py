"""PostgreSQL-backed checkout idempotency and aggregate locking."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog import service as catalog_service
from app.catalog.schemas import ProductCreate
from app.core.errors import ValidationError
from app.idempotency.models import IdempotencyRecord
from app.inventory import service as inventory_service
from app.inventory.models import StockMovement
from app.rbac.models import Role
from app.sales import service as sales_service
from app.sales.models import Payment, Sale, SaleStatus
from app.sales.schemas import CheckoutRequest, PaymentCreate, SaleCreate, SaleLineCreate
from app.users.models import User


@dataclass(frozen=True)
class ReadyCheckout:
    sale_id: int
    product_id: int
    warehouse_id: int
    location_id: int
    actor_user_id: int


async def _ready_checkout(
    maker: async_sessionmaker[AsyncSession],
    *,
    tag: str,
    stock: Decimal = Decimal("20"),
    quantity: Decimal = Decimal("1"),
) -> ReadyCheckout:
    async with maker() as session:
        cashier_role = (
            await session.execute(select(Role).where(Role.name == "CASHIER"))
        ).scalar_one()
        cashier = User(
            email=f"checkout-idempotency-{tag.lower()}@example.com",
            full_name=f"Checkout idempotency {tag}",
            password_hash="unused",
            role_id=cashier_role.id,
        )
        session.add(cashier)
        await session.flush()
        product = await catalog_service.create_product(
            session,
            ProductCreate(
                sku=f"CHECKOUT-IDEMPOTENCY-{tag}",
                name=f"Checkout idempotency {tag}",
                base_unit_name="UNIDAD",
                cost=Decimal("1"),
                list_price=Decimal("1"),
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
            quantity=stock,
            movement_type="ADJUSTMENT",
            unit_cost=Decimal("1"),
        )
        sale = await sales_service.create_sale(
            session, SaleCreate(warehouse_id=warehouse.id, location_id=location.id)
        )
        await sales_service.add_line(
            session,
            sale.id,
            SaleLineCreate(
                product_id=product.id,
                package_id=product.packages[0].id,
                quantity_packages=quantity,
            ),
        )
        await session.commit()
        return ReadyCheckout(
            sale_id=sale.id,
            product_id=product.id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            actor_user_id=cashier.id,
        )


def _checkout_payload(amount: str = "1") -> CheckoutRequest:
    return CheckoutRequest(payments=[PaymentCreate(method="CASH", amount=Decimal(amount))])


async def test_failed_checkout_rolls_back_its_key_and_can_be_corrected(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_checkout(
        committing_sessionmaker,
        tag="FAILED",
        quantity=Decimal("2"),
    )
    key = "failed-checkout-can-be-corrected"

    async with committing_sessionmaker() as session:
        with pytest.raises(ValidationError):
            await sales_service.checkout(
                session,
                ready.sale_id,
                _checkout_payload("1"),
                idempotency_key=key,
                actor_user_id=ready.actor_user_id,
            )
        await session.rollback()

    async with committing_sessionmaker() as session:
        record_count = await session.scalar(
            select(func.count())
            .select_from(IdempotencyRecord)
            .where(IdempotencyRecord.idempotency_key == key)
        )
        sale = await session.get(Sale, ready.sale_id)
    assert record_count == 0
    assert sale is not None and sale.status == SaleStatus.DRAFT

    async with committing_sessionmaker() as session:
        completed = await sales_service.checkout(
            session,
            ready.sale_id,
            _checkout_payload("2"),
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
    assert completed.status == SaleStatus.COMPLETED


async def test_commit_failure_persists_neither_checkout_nor_success_record(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_checkout(committing_sessionmaker, tag="COMMIT-FAILURE")
    key = "checkout-that-fails-at-commit"

    async with committing_sessionmaker() as session:
        completed = await sales_service.checkout(
            session,
            ready.sale_id,
            _checkout_payload(),
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        assert completed.status == SaleStatus.COMPLETED
        # Deliberately violate an existing constraint only when PostgreSQL
        # flushes/commits. The idempotency record must roll back with the
        # otherwise-successful checkout.
        session.add(
            Sale(
                warehouse_id=ready.warehouse_id,
                location_id=ready.location_id,
                status=SaleStatus.COMPLETED,
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

    async with committing_sessionmaker() as session:
        persisted_sale = await session.get(Sale, ready.sale_id)
        record_count = await session.scalar(
            select(func.count())
            .select_from(IdempotencyRecord)
            .where(IdempotencyRecord.idempotency_key == key)
        )
        payment_count = await session.scalar(
            select(func.count()).select_from(Payment).where(Payment.sale_id == ready.sale_id)
        )
        movement_count = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(
                StockMovement.reference_type == "sale",
                StockMovement.reference_id == ready.sale_id,
            )
        )
        balances = await inventory_service.list_balances(
            session, product_id=ready.product_id, warehouse_id=ready.warehouse_id
        )
    assert persisted_sale is not None and persisted_sale.status == SaleStatus.DRAFT
    assert record_count == payment_count == movement_count == 0
    assert balances[0].quantity == Decimal("20")


async def test_concurrent_same_key_requests_share_one_checkout_result(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_checkout(committing_sessionmaker, tag="SAME-KEY")
    key = "concurrent-same-checkout-key"

    async def attempt() -> tuple[int | None, str, int]:
        async with committing_sessionmaker() as session:
            completed = await sales_service.checkout(
                session,
                ready.sale_id,
                _checkout_payload(),
                idempotency_key=key,
                actor_user_id=ready.actor_user_id,
            )
            result = completed.number, completed.status, len(completed.payments)
            await session.commit()
            return result

    results = await asyncio.gather(attempt(), attempt())

    assert results[0] == results[1]
    assert results[0][1:] == (SaleStatus.COMPLETED, 1)
    async with committing_sessionmaker() as session:
        payment_count = await session.scalar(
            select(func.count()).select_from(Payment).where(Payment.sale_id == ready.sale_id)
        )
        movement_count = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(
                StockMovement.reference_type == "sale",
                StockMovement.reference_id == ready.sale_id,
            )
        )
        record_count = await session.scalar(
            select(func.count())
            .select_from(IdempotencyRecord)
            .where(IdempotencyRecord.idempotency_key == key)
        )
        balances = await inventory_service.list_balances(
            session, product_id=ready.product_id, warehouse_id=ready.warehouse_id
        )
    assert payment_count == movement_count == record_count == 1
    assert balances[0].quantity == Decimal("19")


async def test_two_sales_lock_products_in_a_stable_order_without_deadlock(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    async with committing_sessionmaker() as session:
        cashier_role = (
            await session.execute(select(Role).where(Role.name == "CASHIER"))
        ).scalar_one()
        cashier = User(
            email="checkout-lock-order@example.com",
            full_name="Checkout lock order",
            password_hash="unused",
            role_id=cashier_role.id,
        )
        session.add(cashier)
        await session.flush()
        products = []
        for suffix in ("A", "B"):
            products.append(
                await catalog_service.create_product(
                    session,
                    ProductCreate(
                        sku=f"CHECKOUT-LOCK-ORDER-{suffix}",
                        name=f"Checkout lock order {suffix}",
                        base_unit_name="UNIDAD",
                        cost=Decimal("1"),
                        list_price=Decimal("1"),
                        tax_rate=Decimal("0"),
                    ),
                )
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
        for product in products:
            await inventory_service.record_movement(
                session,
                product_id=product.id,
                warehouse_id=warehouse.id,
                location_id=location.id,
                quantity=Decimal("10"),
                movement_type="ADJUSTMENT",
                unit_cost=Decimal("1"),
            )
        product_packages = [(product, product.packages[0].id) for product in products]

        sale_ids: list[int] = []
        for line_order in (product_packages, list(reversed(product_packages))):
            sale = await sales_service.create_sale(
                session, SaleCreate(warehouse_id=warehouse.id, location_id=location.id)
            )
            for product, package_id in line_order:
                await sales_service.add_line(
                    session,
                    sale.id,
                    SaleLineCreate(
                        product_id=product.id,
                        package_id=package_id,
                        quantity_packages=Decimal("1"),
                    ),
                )
            sale_ids.append(sale.id)
        await session.commit()
        actor_user_id = cashier.id
        product_ids = [product.id for product in products]
        warehouse_id = warehouse.id

    async def attempt(sale_id: int, key: str) -> str:
        async with committing_sessionmaker() as session:
            sale = await sales_service.checkout(
                session,
                sale_id,
                _checkout_payload("2"),
                idempotency_key=key,
                actor_user_id=actor_user_id,
            )
            await session.commit()
            return sale.status

    results = await asyncio.wait_for(
        asyncio.gather(
            attempt(sale_ids[0], "lock-order-sale-a"),
            attempt(sale_ids[1], "lock-order-sale-b"),
        ),
        timeout=10,
    )

    assert len(results) == 2
    assert all(result == SaleStatus.COMPLETED for result in results)
    async with committing_sessionmaker() as session:
        balances = {
            product_id: (
                await inventory_service.list_balances(
                    session, product_id=product_id, warehouse_id=warehouse_id
                )
            )[0].quantity
            for product_id in product_ids
        }
    assert balances == {product_id: Decimal("8") for product_id in product_ids}
