"""Return processing: refund, restock, or both — independently per line
(rule 9). See the module docstring in ``app.returns.models``."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog.models import Product
from app.core.context import get_user_id
from app.core.errors import NotFoundError, ValidationError
from app.db.types import NUMERIC_EPSILON
from app.inventory import service as inventory_service
from app.inventory.models import MovementType
from app.lots import service as lots_service
from app.lots.models import Lot
from app.lots.schemas import LotCreate
from app.returns.models import Return, ReturnLine
from app.returns.schemas import ReturnCreate, ReturnLineCreate
from app.sales.models import Sale, SaleLine, SaleStatus

_RETURN_OPTIONS = (
    selectinload(Return.lines).selectinload(ReturnLine.product),
    selectinload(Return.lines).selectinload(ReturnLine.lot),
)


def _q(value: Decimal) -> Decimal:
    """Same rationale as ``app.sales.service._q``/``app.purchasing.service._q``
    — quantize computed totals to the NUMERIC(18,6) scale everything else
    is stored at."""
    return value.quantize(NUMERIC_EPSILON)


async def get_return(session: AsyncSession, return_id: int) -> Return:
    stmt = (
        select(Return)
        .where(Return.id == return_id)
        .options(*_RETURN_OPTIONS)
        .execution_options(populate_existing=True)
    )
    ret = (await session.execute(stmt)).scalar_one_or_none()
    if ret is None:
        raise NotFoundError(f"Return {return_id} not found.")
    return ret


async def list_returns(session: AsyncSession, *, sale_id: int | None = None) -> list[Return]:
    stmt = select(Return).options(*_RETURN_OPTIONS).order_by(Return.created_at.desc())
    if sale_id is not None:
        stmt = stmt.where(Return.sale_id == sale_id)
    return list((await session.execute(stmt)).scalars())


async def _get_or_create_lot(session: AsyncSession, *, product_id: int, lot_number: str) -> int:
    existing = (
        await session.execute(
            select(Lot).where(Lot.product_id == product_id, Lot.lot_number == lot_number)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing.id

    # No supplier/purchase order to trace back to — this lot's provenance
    # is a customer return, not a delivery (both columns are nullable for
    # exactly this reason, see app.lots.models.Lot).
    lot = await lots_service.create_lot(
        session, LotCreate(product_id=product_id, lot_number=lot_number)
    )
    return lot.id


async def create_return(session: AsyncSession, sale_id: int, payload: ReturnCreate) -> Return:
    sale_stmt = select(Sale).where(Sale.id == sale_id).options(selectinload(Sale.lines))
    sale = (await session.execute(sale_stmt)).scalar_one_or_none()
    if sale is None:
        raise ValidationError(f"Sale {sale_id} does not exist.")
    if sale.status != SaleStatus.COMPLETED:
        raise ValidationError(
            f"Only a completed sale can be returned against (this one is {sale.status})."
        )

    lines_by_id = {line.id: line for line in sale.lines}

    ret = Return(sale_id=sale_id, notes=payload.notes, processed_by_user_id=get_user_id())
    session.add(ret)
    await session.flush()

    for line_payload in payload.lines:
        await _apply_return_line(session, ret, sale, lines_by_id, line_payload)

    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="return",
        entity_id=ret.id,
        after={"sale_id": sale_id, "lines": len(payload.lines)},
    )
    return await get_return(session, ret.id)


async def _apply_return_line(
    session: AsyncSession,
    ret: Return,
    sale: Sale,
    lines_by_id: dict[int, SaleLine],
    line_payload: ReturnLineCreate,
) -> None:
    sale_line = lines_by_id.get(line_payload.sale_line_id)
    if sale_line is None:
        raise ValidationError(
            f"Line {line_payload.sale_line_id} does not belong to sale {sale.id}."
        )

    quantity_base = line_payload.quantity_packages * sale_line.package_factor
    remaining = sale_line.quantity_base - sale_line.quantity_returned
    if quantity_base > remaining:
        remaining_packages = remaining / sale_line.package_factor
        raise ValidationError(
            f"Line {sale_line.id}: returning {line_payload.quantity_packages} would exceed "
            f"the {remaining_packages} still returnable."
        )

    refund_amount = Decimal(0)
    if line_payload.economic:
        # Same formula as app.sales.service.compute_line_totals, scaled to
        # the returned quantity instead of the full line — reusing the
        # line's own snapshotted rates (rule 6/7), never the product's
        # current ones.
        subtotal = quantity_base * sale_line.unit_price
        discount_amount = subtotal * sale_line.discount_rate / Decimal(100)
        net = subtotal - discount_amount
        tax_amount = net * sale_line.tax_rate / Decimal(100)
        refund_amount = _q(net + tax_amount)

    lot_id: int | None = None
    movement_id: int | None = None
    if line_payload.physical:
        product = await session.get(Product, sale_line.product_id)
        assert product is not None  # FK guarantees this
        if product.track_lots:
            if not line_payload.lot_number:
                raise ValidationError(
                    f"Line {sale_line.id}: product {product.sku} tracks lots — "
                    "lot_number is required to restock it."
                )
            lot_id = await _get_or_create_lot(
                session, product_id=product.id, lot_number=line_payload.lot_number
            )
        movement = await inventory_service.record_movement(
            session,
            product_id=sale_line.product_id,
            warehouse_id=sale.warehouse_id,
            location_id=sale.location_id,
            lot_id=lot_id,
            quantity=quantity_base,
            movement_type=MovementType.RETURN,
            unit_cost=product.cost,
            reference_type="return",
            reference_id=ret.id,
        )
        movement_id = movement.id

    sale_line.quantity_returned = sale_line.quantity_returned + quantity_base

    session.add(
        ReturnLine(
            return_id=ret.id,
            sale_line_id=sale_line.id,
            product_id=sale_line.product_id,
            package_id=sale_line.package_id,
            package_name=sale_line.package_name,
            package_factor=sale_line.package_factor,
            quantity_packages=line_payload.quantity_packages,
            quantity_base=quantity_base,
            is_economic=line_payload.economic,
            is_physical=line_payload.physical,
            refund_amount=refund_amount,
            lot_id=lot_id,
            stock_movement_id=movement_id,
        )
    )
