"""Lots and FEFO (First Expired, First Out) allocation.

Where a lot's stock actually *is* lives in ``app.inventory``
(``stock_balance``/``stock_movements``, keyed in part by ``lot_id``); this
module adds the lot catalogue and the allocation algorithm phase 11 (sales)
calls to decide which lots a sale draws from.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.catalog.models import Product
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.inventory import service as inventory_service
from app.inventory.models import StockBalance
from app.lots.models import Lot
from app.lots.schemas import LotCreate
from app.purchasing.models import PurchaseOrder
from app.suppliers.models import Supplier


async def _product_or_422(session: AsyncSession, product_id: int) -> Product:
    product = await session.get(Product, product_id)
    if product is None:
        raise ValidationError(f"Product {product_id} does not exist.")
    return product


async def create_lot(session: AsyncSession, payload: LotCreate) -> Lot:
    await _product_or_422(session, payload.product_id)
    if payload.supplier_id is not None and await session.get(Supplier, payload.supplier_id) is None:
        raise ValidationError(f"Supplier {payload.supplier_id} does not exist.")
    if (
        payload.purchase_order_id is not None
        and await session.get(PurchaseOrder, payload.purchase_order_id) is None
    ):
        raise ValidationError(f"Purchase order {payload.purchase_order_id} does not exist.")

    existing = (
        await session.execute(
            select(Lot).where(
                Lot.product_id == payload.product_id, Lot.lot_number == payload.lot_number
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Product already has a lot numbered {payload.lot_number!r}.")

    lot = Lot(
        product_id=payload.product_id,
        lot_number=payload.lot_number,
        manufacturing_date=payload.manufacturing_date,
        expiration_date=payload.expiration_date,
        supplier_id=payload.supplier_id,
        purchase_order_id=payload.purchase_order_id,
    )
    session.add(lot)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="lot",
        entity_id=lot.id,
        after={
            "product_id": payload.product_id,
            "lot_number": payload.lot_number,
            "expiration_date": str(payload.expiration_date) if payload.expiration_date else None,
        },
    )
    return lot


async def get_lot(session: AsyncSession, lot_id: int) -> Lot:
    lot = await session.get(Lot, lot_id)
    if lot is None:
        raise NotFoundError(f"Lot {lot_id} not found.")
    return lot


async def list_lots(
    session: AsyncSession,
    *,
    product_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Lot]:
    stmt = (
        select(Lot)
        .order_by(Lot.expiration_date.asc().nulls_last(), Lot.id)
        .limit(limit)
        .offset(offset)
    )
    if product_id is not None:
        stmt = stmt.where(Lot.product_id == product_id)
    return list((await session.execute(stmt)).scalars())


@dataclass(frozen=True)
class LotBalance:
    lot: Lot
    quantity: Decimal


async def lot_balances(
    session: AsyncSession, *, product_id: int, warehouse_id: int, location_id: int
) -> list[LotBalance]:
    """Positive-stock lots for this product at this location, FEFO order
    (earliest expiration first; undated lots last)."""
    context = await inventory_service.validate_inventory_context(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        location_id=location_id,
        lot_id=None,
        enforce_lot_policy=False,
    )
    if not context.product.track_lots:
        raise ValidationError(f"Product {product_id} does not track lots.")
    stmt = (
        select(StockBalance, Lot)
        .join(
            Lot,
            (Lot.id == StockBalance.lot_id) & (Lot.product_id == StockBalance.product_id),
        )
        .where(
            StockBalance.product_id == product_id,
            StockBalance.warehouse_id == warehouse_id,
            StockBalance.location_id == location_id,
            StockBalance.quantity > 0,
        )
        .order_by(Lot.expiration_date.asc().nulls_last(), Lot.id)
    )
    rows = (await session.execute(stmt)).all()
    return [LotBalance(lot=lot, quantity=balance.quantity) for balance, lot in rows]


@dataclass(frozen=True)
class FefoAllocation:
    lot: Lot
    quantity: Decimal
    #: Set only once the allocation has actually been written to the
    #: ledger by :func:`execute_fefo_consumption` — a pure :func:`plan_fefo`
    #: result has no movement yet.
    movement_id: int | None = None


async def plan_fefo(
    session: AsyncSession,
    *,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    quantity: Decimal,
) -> list[FefoAllocation]:
    """Decide which lots to draw ``quantity`` from, earliest-expiring
    first, without touching the ledger — a pure plan phase 11 can preview
    before committing to a sale."""
    balances = await lot_balances(
        session, product_id=product_id, warehouse_id=warehouse_id, location_id=location_id
    )

    remaining = quantity
    allocations: list[FefoAllocation] = []
    for balance in balances:
        if remaining <= 0:
            break
        take = min(balance.quantity, remaining)
        allocations.append(FefoAllocation(lot=balance.lot, quantity=take))
        remaining -= take

    if remaining > 0:
        available = quantity - remaining
        raise ValidationError(
            f"Not enough lot stock: requested {quantity}, only {available} available across lots."
        )
    return allocations


async def execute_fefo_consumption(
    session: AsyncSession,
    *,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    quantity: Decimal,
    movement_type: str,
    unit_cost: Decimal,
    reference_type: str | None = None,
    reference_id: int | None = None,
    reason: str = "",
) -> list[FefoAllocation]:
    """Plan and immediately execute a FEFO-ordered reduction as real ledger
    movements — one per lot drawn from, all in the same transaction (rule
    5). This is the exact mechanism phase 11 wires up to checkout
    (``movement_type="SALE"``, ``reference_type="sale"``); also reachable
    directly for manual reductions (waste, adjustments) that should still
    respect FEFO.
    """
    planned = await plan_fefo(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity=quantity,
    )

    executed: list[FefoAllocation] = []
    for allocation in planned:
        movement = await inventory_service.record_movement(
            session,
            product_id=product_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            lot_id=allocation.lot.id,
            quantity=-allocation.quantity,
            movement_type=movement_type,
            unit_cost=unit_cost,
            reference_type=reference_type,
            reference_id=reference_id,
        )
        executed.append(
            FefoAllocation(
                lot=allocation.lot, quantity=allocation.quantity, movement_id=movement.id
            )
        )

    audit_after: dict[str, Any] = {
        "movement_type": movement_type,
        "quantity": str(quantity),
        "reason": reason,
        "lots": [{"lot_id": a.lot.id, "quantity": str(a.quantity)} for a in executed],
    }
    await audit.record(
        session,
        action="fefo_consumed",
        entity_type="product",
        entity_id=product_id,
        after=audit_after,
    )
    return executed
