"""Purchase order management.

Only ``DRAFT -> ORDERED -> CANCELLED`` is driven here — see the module
docstring in ``app.purchasing`` for why ``PARTIALLY_RECEIVED``/``RECEIVED``
belong to phase 9.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog.models import ProductPackage
from app.core.context import get_user_id
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.types import NUMERIC_EPSILON
from app.purchasing.models import PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus
from app.purchasing.schemas import PurchaseOrderCreate, PurchaseOrderLineCreate
from app.suppliers.models import Supplier

_ORDER_OPTIONS = (
    selectinload(PurchaseOrder.supplier),
    selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.product),
    selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.package),
)


@dataclass(frozen=True)
class LineTotals:
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total: Decimal


def _q(value: Decimal) -> Decimal:
    """Quantize to the same NUMERIC(18,6) scale every stored money/quantity
    column uses. Multiplying two 6-decimal-place Decimals is exact but
    yields up to 12 places (rule 8 requires Decimal, not that it be
    unrounded) — quantizing keeps computed and stored figures consistently
    formatted throughout the API."""
    return value.quantize(NUMERIC_EPSILON)


def compute_line_totals(line: PurchaseOrderLine) -> LineTotals:
    """Deterministic from the line's own snapshots — never stored, so there
    is nothing that could drift out of sync with them."""
    subtotal = line.quantity_packages * line.unit_cost
    discount_amount = subtotal * line.discount_rate / Decimal(100)
    net = subtotal - discount_amount
    tax_amount = net * line.tax_rate / Decimal(100)
    return LineTotals(
        subtotal=_q(subtotal),
        discount_amount=_q(discount_amount),
        tax_amount=_q(tax_amount),
        total=_q(net + tax_amount),
    )


def _order_snapshot(order: PurchaseOrder) -> dict[str, Any]:
    return {"supplier_id": order.supplier_id, "status": order.status, "notes": order.notes}


async def get_order(session: AsyncSession, order_id: int) -> PurchaseOrder:
    stmt = (
        select(PurchaseOrder)
        .where(PurchaseOrder.id == order_id)
        .options(*_ORDER_OPTIONS)
        .execution_options(populate_existing=True)
    )
    order = (await session.execute(stmt)).scalar_one_or_none()
    if order is None:
        raise NotFoundError(f"Purchase order {order_id} not found.")
    return order


async def list_orders(
    session: AsyncSession, *, supplier_id: int | None = None, status: str | None = None
) -> list[PurchaseOrder]:
    stmt = select(PurchaseOrder).options(*_ORDER_OPTIONS).order_by(PurchaseOrder.created_at.desc())
    if supplier_id is not None:
        stmt = stmt.where(PurchaseOrder.supplier_id == supplier_id)
    if status is not None:
        stmt = stmt.where(PurchaseOrder.status == status)
    return list((await session.execute(stmt)).scalars())


async def _supplier_or_422(session: AsyncSession, supplier_id: int) -> Supplier:
    supplier = await session.get(Supplier, supplier_id)
    if supplier is None:
        raise ValidationError(f"Supplier {supplier_id} does not exist.")
    return supplier


async def create_order(session: AsyncSession, payload: PurchaseOrderCreate) -> PurchaseOrder:
    await _supplier_or_422(session, payload.supplier_id)

    order = PurchaseOrder(
        supplier_id=payload.supplier_id, notes=payload.notes, created_by_user_id=get_user_id()
    )
    session.add(order)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="purchase_order",
        entity_id=order.id,
        after=_order_snapshot(order),
    )
    return await get_order(session, order.id)


async def _package_or_422(
    session: AsyncSession, product_id: int, package_id: int
) -> ProductPackage:
    package = await session.get(ProductPackage, package_id)
    if package is None or package.product_id != product_id:
        raise ValidationError(f"Package {package_id} does not belong to product {product_id}.")
    return package


async def add_line(
    session: AsyncSession, order_id: int, payload: PurchaseOrderLineCreate
) -> PurchaseOrder:
    order = await get_order(session, order_id)
    if order.status != PurchaseOrderStatus.DRAFT:
        raise ConflictError("Lines can only be added to a draft purchase order.")
    package = await _package_or_422(session, payload.product_id, payload.package_id)

    line = PurchaseOrderLine(
        purchase_order_id=order_id,
        product_id=payload.product_id,
        package_id=payload.package_id,
        package_name=package.name,
        package_factor=package.factor,
        quantity_packages=payload.quantity_packages,
        quantity_ordered=payload.quantity_packages * package.factor,
        unit_cost=payload.unit_cost,
        tax_rate=payload.tax_rate,
        discount_rate=payload.discount_rate,
    )
    session.add(line)
    await session.flush()
    await audit.record(
        session,
        action="line_added",
        entity_type="purchase_order",
        entity_id=order_id,
        after={
            "product_id": payload.product_id,
            "package": package.name,
            "quantity_packages": str(payload.quantity_packages),
        },
    )
    return await get_order(session, order_id)


async def remove_line(session: AsyncSession, order_id: int, line_id: int) -> PurchaseOrder:
    order = await get_order(session, order_id)
    if order.status != PurchaseOrderStatus.DRAFT:
        raise ConflictError("Lines can only be removed from a draft purchase order.")
    line = next((candidate for candidate in order.lines if candidate.id == line_id), None)
    if line is None:
        raise NotFoundError(f"Line {line_id} not found on order {order_id}.")

    await session.delete(line)
    await session.flush()
    await audit.record(
        session,
        action="line_removed",
        entity_type="purchase_order",
        entity_id=order_id,
        before={"line_id": line_id},
    )
    return await get_order(session, order_id)


async def place_order(session: AsyncSession, order_id: int) -> PurchaseOrder:
    order = await get_order(session, order_id)
    if order.status != PurchaseOrderStatus.DRAFT:
        raise ConflictError(f"Only a draft order can be placed (current status: {order.status}).")
    if not order.lines:
        raise ValidationError("Cannot place an order with no lines.")

    before = _order_snapshot(order)
    order.status = PurchaseOrderStatus.ORDERED
    order.ordered_at = datetime.now(UTC)
    await session.flush()
    await audit.record(
        session,
        action="ordered",
        entity_type="purchase_order",
        entity_id=order_id,
        before=before,
        after=_order_snapshot(order),
    )
    return await get_order(session, order_id)


async def cancel_order(session: AsyncSession, order_id: int) -> PurchaseOrder:
    order = await get_order(session, order_id)
    if order.status not in (PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.ORDERED):
        raise ConflictError(f"Cannot cancel an order that is already {order.status}.")

    before = _order_snapshot(order)
    order.status = PurchaseOrderStatus.CANCELLED
    await session.flush()
    await audit.record(
        session,
        action="cancelled",
        entity_type="purchase_order",
        entity_id=order_id,
        before=before,
        after=_order_snapshot(order),
    )
    return await get_order(session, order_id)


async def product_purchase_history(
    session: AsyncSession, product_id: int
) -> list[PurchaseOrderLine]:
    """Every line ever ordered for this product, most recent order first —
    date, supplier, quantity, price, presentation (spec: consultable from
    the product record)."""
    stmt = (
        select(PurchaseOrderLine)
        .join(PurchaseOrder)
        .where(PurchaseOrderLine.product_id == product_id)
        .options(
            selectinload(PurchaseOrderLine.purchase_order).selectinload(PurchaseOrder.supplier)
        )
        .order_by(PurchaseOrder.created_at.desc(), PurchaseOrderLine.id.desc())
    )
    return list((await session.execute(stmt)).scalars())
