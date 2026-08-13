"""Return processing: refund, restock, or both — independently per line
(rule 9). See the module docstring in ``app.returns.models``."""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.core.context import get_user_id
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.types import NUMERIC_EPSILON
from app.idempotency import service as idempotency_service
from app.inventory import service as inventory_service
from app.inventory.models import MovementType
from app.lots import service as lots_service
from app.lots.schemas import LotCreate
from app.returns.models import Return, ReturnLine
from app.returns.schemas import ReturnCreate, ReturnLineCreate
from app.sales import accounting
from app.sales.models import Sale, SaleLine, SaleStatus

_RETURN_OPTIONS = (
    selectinload(Return.lines).selectinload(ReturnLine.sale_line),
    selectinload(Return.lines).selectinload(ReturnLine.lot),
)

_CREATE_RETURN_OPERATION = "return.create"


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


async def list_returns(
    session: AsyncSession,
    *,
    sale_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Return]:
    stmt = (
        select(Return)
        .options(*_RETURN_OPTIONS)
        .order_by(Return.created_at.desc(), Return.id.desc())
        .limit(limit)
        .offset(offset)
    )
    if sale_id is not None:
        stmt = stmt.where(Return.sale_id == sale_id)
    return list((await session.execute(stmt)).scalars())


async def _get_or_create_lot(session: AsyncSession, *, product_id: int, lot_number: str) -> int:
    # No supplier/purchase order to trace back to — this lot's provenance
    # is a customer return, not a delivery (both columns are nullable for
    # exactly this reason, see app.lots.models.Lot).
    lot = await lots_service.get_or_create_lot(
        session, LotCreate(product_id=product_id, lot_number=lot_number)
    )
    return lot.id


def return_request_fingerprint(sale_id: int, payload: ReturnCreate) -> str:
    lines = [
        {
            "sale_line_id": line.sale_line_id,
            "quantity_packages": format(_q(line.quantity_packages), "f"),
            "economic": line.economic,
            "physical": line.physical,
            # The service ignores lot_number for an economic-only return;
            # an ignored spelling cannot define a different intention.
            "lot_number": line.lot_number if line.physical else None,
        }
        for line in sorted(
            payload.lines,
            key=lambda line: (
                line.sale_line_id,
                line.lot_number if line.physical and line.lot_number else "",
                format(_q(line.quantity_packages), "f"),
                line.economic,
                line.physical,
            ),
        )
    ]
    canonical = json.dumps(
        {"sale_id": sale_id, "notes": payload.notes, "lines": lines},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _get_sale_for_return(session: AsyncSession, sale_id: int) -> Sale:
    sale_stmt = (
        select(Sale)
        .where(Sale.id == sale_id)
        .options(selectinload(Sale.lines))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    sale = (await session.execute(sale_stmt)).scalar_one_or_none()
    if sale is None:
        raise ValidationError(f"Sale {sale_id} does not exist.")
    return sale


async def create_return(
    session: AsyncSession,
    sale_id: int,
    payload: ReturnCreate,
    *,
    idempotency_key: str | None = None,
    actor_user_id: int | None = None,
) -> Return:
    claim = None
    if idempotency_key is not None:
        actor_id = actor_user_id if actor_user_id is not None else get_user_id()
        if actor_id is None:
            raise ValidationError("An authenticated user is required for an idempotent return.")
        claim = await idempotency_service.claim(
            session,
            operation=_CREATE_RETURN_OPERATION,
            idempotency_key=idempotency_key,
            request_fingerprint=return_request_fingerprint(sale_id, payload),
            resource_id=sale_id,
            actor_user_id=actor_id,
        )
        if not claim.is_new:
            if claim.record.result_resource_id is None:
                raise ConflictError("The idempotent return result is not available.")
            return await get_return(session, claim.record.result_resource_id)

    warehouse_id = await session.scalar(select(Sale.warehouse_id).where(Sale.id == sale_id))
    if warehouse_id is None:
        raise ValidationError(f"Sale {sale_id} does not exist.")
    await accounting.lock_warehouse_cut(session, warehouse_id)

    sale = await _get_sale_for_return(session, sale_id)
    if sale.status != SaleStatus.COMPLETED:
        raise ValidationError(
            f"Only a completed sale can be returned against (this one is {sale.status})."
        )

    lines_by_id = {line.id: line for line in sale.lines}
    assert sale.prices_include_tax is not None  # enforced for every completed sale by the DB

    # Reject every inventory-context error before materialising the return
    # header. The request transaction would roll back a later error too, but
    # preflight keeps this multi-write service atomic even for direct callers
    # and prevents a bad line after a good one from leaving pending ORM rows.
    def execution_order(line: ReturnLineCreate) -> tuple[int, str, int]:
        sale_line = lines_by_id.get(line.sale_line_id)
        return (
            sale_line.product_id if sale_line is not None else -1,
            line.lot_number or "",
            line.sale_line_id,
        )

    ordered_line_payloads = sorted(payload.lines, key=execution_order)
    for line_payload in ordered_line_payloads:
        sale_line = lines_by_id.get(line_payload.sale_line_id)
        if sale_line is None:
            raise ValidationError(
                f"Line {line_payload.sale_line_id} does not belong to sale {sale.id}."
            )
        quantity_base = line_payload.quantity_packages * sale_line.package_factor
        remaining = sale_line.quantity_base - sale_line.quantity_returned
        if quantity_base > remaining:
            remaining_packages = remaining / sale_line.package_factor
            error_type = (
                ConflictError if quantity_base <= sale_line.quantity_base else ValidationError
            )
            raise error_type(
                f"Line {sale_line.id}: returning {line_payload.quantity_packages} would exceed "
                f"the {remaining_packages} still returnable."
            )
        if line_payload.physical and sale_line.tracks_stock:
            if sale_line.track_lots and not line_payload.lot_number:
                raise ValidationError(
                    f"Line {sale_line.id}: product {sale_line.product_sku} tracks lots — "
                    "lot_number is required to restock it."
                )
            if not sale_line.track_lots and line_payload.lot_number:
                raise ValidationError(
                    f"Line {sale_line.id}: product {sale_line.product_sku} does not track lots — "
                    "lot_number is forbidden."
                )
            await inventory_service.validate_inventory_context(
                session,
                product_id=sale_line.product_id,
                warehouse_id=sale.warehouse_id,
                location_id=sale.location_id,
                lot_id=None,
                enforce_lot_policy=False,
            )

    resolved_lot_ids: list[int | None] = []
    for line_payload in ordered_line_payloads:
        sale_line = lines_by_id[line_payload.sale_line_id]
        lot_id = None
        if line_payload.physical and sale_line.tracks_stock and sale_line.track_lots:
            assert line_payload.lot_number is not None  # preflight above
            lot_id = await _get_or_create_lot(
                session,
                product_id=sale_line.product_id,
                lot_number=line_payload.lot_number,
            )
            await inventory_service.validate_inventory_context(
                session,
                product_id=sale_line.product_id,
                warehouse_id=sale.warehouse_id,
                location_id=sale.location_id,
                lot_id=lot_id,
            )
        resolved_lot_ids.append(lot_id)

    stock_product_ids = sorted(
        {
            lines_by_id[line.sale_line_id].product_id
            for line in ordered_line_payloads
            if line.physical and lines_by_id[line.sale_line_id].tracks_stock
        }
    )
    for product_id in stock_product_ids:
        await inventory_service.lock_and_get_available_quantity(
            session,
            product_id=product_id,
            warehouse_id=sale.warehouse_id,
            location_id=sale.location_id,
        )

    ret = Return(
        sale_id=sale_id,
        notes=payload.notes,
        processed_by_user_id=get_user_id(),
        # TimestampMixin's server ``now()`` is the transaction start.  A
        # return may have waited behind a Z cut, so use the DB wall clock
        # after acquiring that cut or it could be dated into the closed
        # period while becoming visible only afterwards.
        created_at=await accounting.database_clock(session),
    )
    session.add(ret)
    await session.flush()

    for line_payload, lot_id in zip(ordered_line_payloads, resolved_lot_ids, strict=True):
        await _apply_return_line(
            session,
            ret,
            sale,
            lines_by_id,
            line_payload,
            resolved_lot_id=lot_id,
            prices_include_tax=sale.prices_include_tax,
        )

    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="return",
        entity_id=ret.id,
        after={"sale_id": sale_id, "lines": len(payload.lines)},
    )
    if claim is not None:
        await idempotency_service.complete(session, claim.record, result_resource_id=ret.id)
    return await get_return(session, ret.id)


async def _apply_return_line(
    session: AsyncSession,
    ret: Return,
    sale: Sale,
    lines_by_id: dict[int, SaleLine],
    line_payload: ReturnLineCreate,
    *,
    resolved_lot_id: int | None,
    prices_include_tax: bool,
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
        error_type = ConflictError if quantity_base <= sale_line.quantity_base else ValidationError
        raise error_type(
            f"Line {sale_line.id}: returning {line_payload.quantity_packages} would exceed "
            f"the {remaining_packages} still returnable."
        )

    refund_amount = Decimal(0)
    if line_payload.economic:
        # Same formula as app.sales.service.compute_amounts, scaled to
        # the returned quantity instead of the full line — reusing the
        # line's own snapshotted rates (rule 6/7), never the product's
        # current ones. ``prices_include_tax`` (app.pricing.models.
        # PricingSettings): False adds tax on top of unit_price, True
        # extracts it — either way the customer gets back exactly what
        # that quantity was actually charged.
        subtotal = quantity_base * sale_line.unit_price
        discount_amount = subtotal * sale_line.discount_rate / Decimal(100)
        after_discount = subtotal - discount_amount
        if prices_include_tax:
            refund_amount = _q(after_discount)
        else:
            tax_amount = after_discount * sale_line.tax_rate / Decimal(100)
            refund_amount = _q(after_discount + tax_amount)

    lot_id = resolved_lot_id
    movement_id: int | None = None
    if line_payload.physical:
        # Sin control de existencias no hay nada que devolver al almacén:
        # la venta tampoco descontó nada. Sumar aquí dejaba stock salido de
        # la nada justo en los productos que no deberían tener ninguno —se
        # vendían 3, se devolvía 1, y el saldo pasaba de vacío a 1—. La
        # devolución sigue siendo física (la mercancía vuelve al montón),
        # simplemente no se apunta en ningún sitio.
        restocks = sale_line.tracks_stock
        if restocks and sale_line.track_lots:
            if not line_payload.lot_number:
                raise ValidationError(
                    f"Line {sale_line.id}: product {sale_line.product_sku} tracks lots — "
                    "lot_number is required to restock it."
                )
            if lot_id is None:
                raise ValidationError(
                    f"Line {sale_line.id}: the requested lot could not be resolved."
                )
        if restocks and not sale_line.track_lots and line_payload.lot_number:
            raise ValidationError(
                f"Line {sale_line.id}: product {sale_line.product_sku} does not track lots — "
                "lot_number is forbidden."
            )
        if restocks:
            movement = await inventory_service.record_movement(
                session,
                product_id=sale_line.product_id,
                warehouse_id=sale.warehouse_id,
                location_id=sale.location_id,
                lot_id=lot_id,
                quantity=quantity_base,
                movement_type=MovementType.RETURN,
                unit_cost=sale_line.unit_cost,
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
