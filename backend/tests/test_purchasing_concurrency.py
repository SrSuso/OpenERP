"""PostgreSQL concurrency/idempotency guarantees for purchasing."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog import service as catalog_service
from app.catalog.schemas import ProductCreate
from app.core.errors import ConflictError, ValidationError
from app.idempotency.models import IdempotencyRecord
from app.inventory import service as inventory_service
from app.inventory.models import StockMovement
from app.lots.models import Lot
from app.purchasing import service as purchasing_service
from app.purchasing.models import GoodsReceipt, GoodsReceiptLine, PurchaseOrder, PurchaseOrderStatus
from app.purchasing.schemas import (
    GoodsReceiptCreate,
    GoodsReceiptLineCreate,
    PurchaseOrderCreate,
    PurchaseOrderLineCreate,
)
from app.rbac.models import Role
from app.suppliers.models import Supplier
from app.users.models import User


@dataclass(frozen=True)
class ReadyOrder:
    order_id: int
    line_id: int
    product_id: int
    warehouse_id: int
    location_id: int
    actor_user_id: int


async def _ready_order(
    maker: async_sessionmaker[AsyncSession],
    *,
    tag: str,
    quantity: Decimal = Decimal("10"),
    track_lots: bool = False,
) -> ReadyOrder:
    async with maker() as session:
        manager_role = (
            await session.execute(select(Role).where(Role.name == "MANAGER"))
        ).scalar_one()
        actor = User(
            email=f"purchase-concurrency-{tag.lower()}@example.com",
            full_name=f"Purchase concurrency {tag}",
            password_hash="unused",
            role_id=manager_role.id,
        )
        supplier = Supplier(name=f"Purchase concurrency supplier {tag}")
        session.add_all([actor, supplier])
        await session.flush()
        product = await catalog_service.create_product(
            session,
            ProductCreate(
                sku=f"PURCHASE-CONCURRENCY-{tag}",
                name=f"Purchase concurrency {tag}",
                base_unit_name="UNIDAD",
                cost=Decimal("1"),
                list_price=Decimal("2"),
                track_lots=track_lots,
                track_expiration=track_lots,
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
        order = await purchasing_service.create_order(
            session, PurchaseOrderCreate(supplier_id=supplier.id)
        )
        order = await purchasing_service.add_line(
            session,
            order.id,
            PurchaseOrderLineCreate(
                product_id=product.id,
                package_id=product.packages[0].id,
                quantity_packages=quantity,
                unit_cost=Decimal("1"),
            ),
        )
        line_id = order.lines[0].id
        await session.commit()
        return ReadyOrder(
            order_id=order.id,
            line_id=line_id,
            product_id=product.id,
            warehouse_id=warehouse.id,
            location_id=location.id,
            actor_user_id=actor.id,
        )


def _receipt_payload(
    ready: ReadyOrder,
    quantity: str,
    *,
    lot_number: str | None = None,
) -> GoodsReceiptCreate:
    return GoodsReceiptCreate(
        warehouse_id=ready.warehouse_id,
        location_id=ready.location_id,
        lines=[
            GoodsReceiptLineCreate(
                purchase_order_line_id=ready.line_id,
                quantity_packages=Decimal(quantity),
                lot_number=lot_number,
            )
        ],
    )


def test_receipt_fingerprint_normalizes_decimal_and_line_order() -> None:
    left = GoodsReceiptCreate(
        warehouse_id=1,
        location_id=2,
        notes="same",
        lines=[
            GoodsReceiptLineCreate(
                purchase_order_line_id=20,
                quantity_packages=Decimal("3.0"),
                lot_number="B",
            ),
            GoodsReceiptLineCreate(
                purchase_order_line_id=10,
                quantity_packages=Decimal("2"),
                lot_number="A",
            ),
        ],
    )
    right = GoodsReceiptCreate(
        warehouse_id=1,
        location_id=2,
        notes="same",
        lines=[
            GoodsReceiptLineCreate(
                purchase_order_line_id=10,
                quantity_packages=Decimal("2.000000"),
                lot_number="A",
            ),
            GoodsReceiptLineCreate(
                purchase_order_line_id=20,
                quantity_packages=Decimal("3"),
                lot_number="B",
            ),
        ],
    )

    assert purchasing_service.goods_receipt_request_fingerprint(
        7, left
    ) == purchasing_service.goods_receipt_request_fingerprint(7, right)


async def test_place_order_serializes_transition_and_replays_same_key(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_order(committing_sessionmaker, tag="PLACE")

    async def attempt(key: str) -> tuple[str, int | None]:
        async with committing_sessionmaker() as session:
            try:
                order = await purchasing_service.place_order(
                    session,
                    ready.order_id,
                    idempotency_key=key,
                    actor_user_id=ready.actor_user_id,
                )
                await session.commit()
                return "success", order.id
            except ConflictError:
                await session.rollback()
                return "conflict", None

    outcomes = await asyncio.gather(attempt("place-a"), attempt("place-b"))
    assert sorted(result for result, _order_id in outcomes) == ["conflict", "success"]

    winning_key = next(
        key
        for key, outcome in zip(("place-a", "place-b"), outcomes, strict=True)
        if outcome[0] == "success"
    )
    assert await attempt(winning_key) == ("success", ready.order_id)

    async with committing_sessionmaker() as session:
        order = await session.get(PurchaseOrder, ready.order_id)
        completed_records = await session.scalar(
            select(func.count())
            .select_from(IdempotencyRecord)
            .where(
                IdempotencyRecord.operation == "purchase.place_order",
                IdempotencyRecord.resource_id == ready.order_id,
            )
        )
    assert order is not None and order.status == PurchaseOrderStatus.ORDERED
    assert completed_records == 1


async def test_two_concurrent_receipts_cannot_exceed_the_ordered_quantity(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_order(committing_sessionmaker, tag="R1")
    async with committing_sessionmaker() as session:
        await purchasing_service.place_order(session, ready.order_id)
        await session.commit()

    async def attempt(key: str) -> str:
        async with committing_sessionmaker() as session:
            try:
                await purchasing_service.create_goods_receipt(
                    session,
                    ready.order_id,
                    _receipt_payload(ready, "7"),
                    idempotency_key=key,
                    actor_user_id=ready.actor_user_id,
                )
                await session.commit()
                return "success"
            except ConflictError:
                await session.rollback()
                return "conflict"

    outcomes = await asyncio.gather(attempt("receipt-r1-a"), attempt("receipt-r1-b"))
    assert sorted(outcomes) == ["conflict", "success"]

    async with committing_sessionmaker() as session:
        order = await purchasing_service.get_order(session, ready.order_id)
        receipt_count = await session.scalar(
            select(func.count())
            .select_from(GoodsReceipt)
            .where(GoodsReceipt.purchase_order_id == ready.order_id)
        )
        balances = await inventory_service.list_balances(
            session, product_id=ready.product_id, warehouse_id=ready.warehouse_id
        )
    assert order.lines[0].quantity_received == Decimal("7")
    assert receipt_count == 1
    assert balances[0].quantity == Decimal("7")


async def test_receipt_same_key_replays_sequentially(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_order(committing_sessionmaker, tag="R2")
    payload = _receipt_payload(ready, "7")
    key = "receipt-r2-replay"
    async with committing_sessionmaker() as session:
        await purchasing_service.place_order(session, ready.order_id)
        first = await purchasing_service.create_goods_receipt(
            session,
            ready.order_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
        first_id = first.id
    async with committing_sessionmaker() as session:
        replay = await purchasing_service.create_goods_receipt(
            session,
            ready.order_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
    assert replay.id == first_id


async def test_receipt_same_key_serializes_concurrent_requests(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_order(committing_sessionmaker, tag="R3")
    payload = _receipt_payload(ready, "7")
    key = "receipt-r3-concurrent"
    async with committing_sessionmaker() as session:
        await purchasing_service.place_order(session, ready.order_id)
        await session.commit()

    async def attempt() -> int:
        async with committing_sessionmaker() as session:
            receipt = await purchasing_service.create_goods_receipt(
                session,
                ready.order_id,
                payload,
                idempotency_key=key,
                actor_user_id=ready.actor_user_id,
            )
            await session.commit()
            return receipt.id

    receipt_ids = await asyncio.gather(attempt(), attempt())
    assert receipt_ids[0] == receipt_ids[1]
    async with committing_sessionmaker() as session:
        receipt_count = await session.scalar(
            select(func.count())
            .select_from(GoodsReceipt)
            .where(GoodsReceipt.purchase_order_id == ready.order_id)
        )
        line_count = await session.scalar(
            select(func.count())
            .select_from(GoodsReceiptLine)
            .where(GoodsReceiptLine.goods_receipt_id == receipt_ids[0])
        )
    assert receipt_count == line_count == 1


async def test_receipt_same_key_rejects_a_different_payload(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_order(committing_sessionmaker, tag="R4")
    key = "receipt-r4-mismatch"
    async with committing_sessionmaker() as session:
        await purchasing_service.place_order(session, ready.order_id)
        await purchasing_service.create_goods_receipt(
            session,
            ready.order_id,
            _receipt_payload(ready, "3"),
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
    async with committing_sessionmaker() as session:
        with pytest.raises(ConflictError):
            await purchasing_service.create_goods_receipt(
                session,
                ready.order_id,
                _receipt_payload(ready, "4"),
                idempotency_key=key,
                actor_user_id=ready.actor_user_id,
            )
        await session.rollback()


async def test_lot_receipt_retry_creates_one_lot_movement_and_balance(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_order(committing_sessionmaker, tag="R5", track_lots=True)
    payload = _receipt_payload(ready, "5", lot_number="RECEIPT-R5-LOT")
    key = "receipt-r5-lot"
    async with committing_sessionmaker() as session:
        await purchasing_service.place_order(session, ready.order_id)
        first = await purchasing_service.create_goods_receipt(
            session,
            ready.order_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
        first_id = first.id
    async with committing_sessionmaker() as session:
        replay = await purchasing_service.create_goods_receipt(
            session,
            ready.order_id,
            payload,
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
    assert replay.id == first_id

    async with committing_sessionmaker() as session:
        lot_count = await session.scalar(
            select(func.count())
            .select_from(Lot)
            .where(
                Lot.product_id == ready.product_id,
                Lot.lot_number == "RECEIPT-R5-LOT",
            )
        )
        movement_count = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(
                StockMovement.reference_type == "goods_receipt",
                StockMovement.reference_id == first_id,
            )
        )
        balances = await inventory_service.list_balances(
            session, product_id=ready.product_id, warehouse_id=ready.warehouse_id
        )
    assert lot_count == movement_count == 1
    assert balances[0].quantity == Decimal("5")


async def test_partial_receipt_failure_rolls_back_effects_and_key(
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ready = await _ready_order(committing_sessionmaker, tag="R6")
    key = "receipt-r6-rollback"
    invalid = GoodsReceiptCreate(
        warehouse_id=ready.warehouse_id,
        location_id=ready.location_id,
        lines=[
            GoodsReceiptLineCreate(
                purchase_order_line_id=ready.line_id, quantity_packages=Decimal("6")
            ),
            GoodsReceiptLineCreate(
                purchase_order_line_id=ready.line_id, quantity_packages=Decimal("6")
            ),
        ],
    )
    async with committing_sessionmaker() as session:
        await purchasing_service.place_order(session, ready.order_id)
        await session.commit()
    async with committing_sessionmaker() as session:
        with pytest.raises((ConflictError, ValidationError)):
            await purchasing_service.create_goods_receipt(
                session,
                ready.order_id,
                invalid,
                idempotency_key=key,
                actor_user_id=ready.actor_user_id,
            )
        await session.rollback()

    async with committing_sessionmaker() as session:
        receipt_count = await session.scalar(
            select(func.count())
            .select_from(GoodsReceipt)
            .where(GoodsReceipt.purchase_order_id == ready.order_id)
        )
        record_count = await session.scalar(
            select(func.count())
            .select_from(IdempotencyRecord)
            .where(
                IdempotencyRecord.operation == "purchase.receive",
                IdempotencyRecord.idempotency_key == key,
            )
        )
        movement_count = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(
                StockMovement.product_id == ready.product_id,
                StockMovement.reference_type == "goods_receipt",
            )
        )
        order = await purchasing_service.get_order(session, ready.order_id)
    assert receipt_count == record_count == 0
    assert movement_count == 0
    assert order.lines[0].quantity_received == Decimal("0")

    async with committing_sessionmaker() as session:
        receipt = await purchasing_service.create_goods_receipt(
            session,
            ready.order_id,
            _receipt_payload(ready, "4"),
            idempotency_key=key,
            actor_user_id=ready.actor_user_id,
        )
        await session.commit()
    assert receipt.purchase_order_id == ready.order_id
