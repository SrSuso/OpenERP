"""Atomic economic refunds and physical returns against completed sales."""

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
from app.returns.models import Refund, RefundStatus, Return, ReturnLine
from app.returns.schemas import ReturnCreate, ReturnLineCreate
from app.sales import accounting
from app.sales.models import Sale, SaleLine, SaleStatus
from app.sales.service import compute_amounts

_RETURN_OPTIONS = (
    selectinload(Return.lines).selectinload(ReturnLine.sale_line),
    selectinload(Return.lines).selectinload(ReturnLine.lot),
    selectinload(Return.refund),
)

_CREATE_RETURN_OPERATION = "return.create"


def _q(value: Decimal) -> Decimal:
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
        raise NotFoundError(f"La devolución {return_id} no existe.")
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
    # No supplier/purchase order to trace back to: this lot's provenance is
    # a customer return, not a delivery.
    lot = await lots_service.get_or_create_lot(
        session, LotCreate(product_id=product_id, lot_number=lot_number)
    )
    return lot.id


def return_request_fingerprint(sale_id: int, payload: ReturnCreate) -> str:
    lines = [
        {
            "sale_line_id": line.sale_line_id,
            "refund_quantity_packages": format(_q(line.refund_quantity_packages), "f"),
            "stock_return_quantity_packages": format(_q(line.stock_return_quantity_packages), "f"),
            # Lot identity belongs only to merchandise that physically returns.
            "lot_number": line.lot_number if line.stock_return_quantity_packages > 0 else None,
        }
        for line in sorted(
            payload.lines,
            key=lambda line: (
                line.sale_line_id,
                line.lot_number
                if line.stock_return_quantity_packages > 0 and line.lot_number
                else "",
                format(_q(line.refund_quantity_packages), "f"),
                format(_q(line.stock_return_quantity_packages), "f"),
            ),
        )
    ]
    canonical = json.dumps(
        {
            "sale_id": sale_id,
            "notes": payload.notes,
            "refund_method": payload.refund_method.value if payload.refund_method else None,
            "lines": lines,
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _get_sale_for_return(session: AsyncSession, sale_id: int) -> Sale:
    stmt = (
        select(Sale)
        .where(Sale.id == sale_id)
        .options(selectinload(Sale.lines))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    sale = (await session.execute(stmt)).scalar_one_or_none()
    if sale is None:
        raise ValidationError(f"La venta {sale_id} no existe.")
    return sale


def _return_amount(
    sale_line: SaleLine,
    quantity_base: Decimal,
    *,
    prices_include_tax: bool,
) -> Decimal:
    """Value a cumulative economic quantity with the exact sales formula."""
    return compute_amounts(
        quantity_base,
        sale_line.unit_price,
        sale_line.discount_rate,
        sale_line.tax_rate,
        cold_drink_surcharge=sale_line.cold_drink_surcharge,
        prices_include_tax=prices_include_tax,
    )[3]


def _exceeded_error(
    sale_line: SaleLine,
    *,
    requested_packages: Decimal,
    remaining_base: Decimal,
    dimension: str,
) -> ValidationError | ConflictError:
    remaining_packages = remaining_base / sale_line.package_factor
    error_type = (
        ConflictError
        if requested_packages * sale_line.package_factor <= sale_line.quantity_base
        else ValidationError
    )
    return error_type(
        f"Línea {sale_line.id}: la cantidad de {dimension} ({requested_packages}) supera "
        f"la disponible ({remaining_packages})."
    )


async def create_return(
    session: AsyncSession,
    sale_id: int,
    payload: ReturnCreate,
    *,
    idempotency_key: str | None = None,
    actor_user_id: int | None = None,
) -> Return:
    actor_id = actor_user_id if actor_user_id is not None else get_user_id()
    claim = None
    if idempotency_key is not None:
        if actor_id is None:
            raise ValidationError(
                "Se necesita un usuario autenticado para registrar la devolución."
            )
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
                raise ConflictError("El resultado de esta devolución aún no está disponible.")
            return await get_return(session, claim.record.result_resource_id)

    warehouse_id = await session.scalar(select(Sale.warehouse_id).where(Sale.id == sale_id))
    if warehouse_id is None:
        raise ValidationError(f"La venta {sale_id} no existe.")

    # A completed economic refund affects exactly one Z period. Physical-only
    # returns keep the same lock order for a single deterministic code path.
    await accounting.lock_warehouse_cut(session, warehouse_id)
    sale = await _get_sale_for_return(session, sale_id)
    if sale.status != SaleStatus.COMPLETED:
        raise ValidationError("Sólo se puede registrar una devolución sobre una venta completada.")

    lines_by_id = {line.id: line for line in sale.lines}
    assert sale.prices_include_tax is not None  # completed-sale DB invariant

    def execution_order(line: ReturnLineCreate) -> tuple[int, str, int]:
        sale_line = lines_by_id.get(line.sale_line_id)
        return (
            sale_line.product_id if sale_line is not None else -1,
            line.lot_number or "",
            line.sale_line_id,
        )

    ordered = sorted(payload.lines, key=execution_order)
    planned_refunded = {line.id: line.quantity_refunded for line in sale.lines}
    planned_physical = {line.id: line.quantity_physically_returned for line in sale.lines}

    # Validate both capacities independently before materialising any row.
    for line_payload in ordered:
        sale_line = lines_by_id.get(line_payload.sale_line_id)
        if sale_line is None:
            raise ValidationError(
                f"La línea {line_payload.sale_line_id} no pertenece a esta venta."
            )
        refund_base = line_payload.refund_quantity_packages * sale_line.package_factor
        stock_base = line_payload.stock_return_quantity_packages * sale_line.package_factor
        remaining_refundable = sale_line.quantity_base - planned_refunded[sale_line.id]
        remaining_physical = sale_line.quantity_base - planned_physical[sale_line.id]
        if refund_base > remaining_refundable:
            raise _exceeded_error(
                sale_line,
                requested_packages=line_payload.refund_quantity_packages,
                remaining_base=remaining_refundable,
                dimension="reembolso",
            )
        if stock_base > remaining_physical:
            raise _exceeded_error(
                sale_line,
                requested_packages=line_payload.stock_return_quantity_packages,
                remaining_base=remaining_physical,
                dimension="reposición a stock",
            )
        planned_refunded[sale_line.id] += refund_base
        planned_physical[sale_line.id] += stock_base

        if stock_base == 0:
            if line_payload.lot_number:
                raise ValidationError(
                    f"Línea {sale_line.id}: el lote sólo se puede indicar si el artículo "
                    "vuelve a stock."
                )
            continue
        if not sale_line.tracks_stock:
            if line_payload.lot_number:
                raise ValidationError(
                    f"Línea {sale_line.id}: el artículo no controla existencias; no puede "
                    "indicarse lote."
                )
            continue
        if sale_line.track_lots and not line_payload.lot_number:
            raise ValidationError(
                f"Línea {sale_line.id}: debe indicar el número de lote para reponer este artículo."
            )
        if not sale_line.track_lots and line_payload.lot_number:
            raise ValidationError(f"Línea {sale_line.id}: este artículo no controla lotes.")
        await inventory_service.validate_inventory_context(
            session,
            product_id=sale_line.product_id,
            warehouse_id=sale.warehouse_id,
            location_id=sale.location_id,
            lot_id=None,
            enforce_lot_policy=False,
        )

    resolved_lot_ids: list[int | None] = []
    for line_payload in ordered:
        sale_line = lines_by_id[line_payload.sale_line_id]
        lot_id = None
        if (
            line_payload.stock_return_quantity_packages > 0
            and sale_line.tracks_stock
            and sale_line.track_lots
        ):
            assert line_payload.lot_number is not None
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
            for line in ordered
            if line.stock_return_quantity_packages > 0
            and lines_by_id[line.sale_line_id].tracks_stock
        }
    )
    for product_id in stock_product_ids:
        await inventory_service.lock_and_get_available_quantity(
            session,
            product_id=product_id,
            warehouse_id=sale.warehouse_id,
            location_id=sale.location_id,
        )

    occurred_at = await accounting.database_clock(session)
    ret = Return(
        sale_id=sale_id,
        notes=payload.notes,
        processed_by_user_id=actor_id,
        created_at=occurred_at,
    )
    session.add(ret)
    await session.flush()

    refund_amount = Decimal(0)
    for line_payload, lot_id in zip(ordered, resolved_lot_ids, strict=True):
        refund_amount += await _apply_return_line(
            session,
            ret,
            sale,
            lines_by_id,
            line_payload,
            resolved_lot_id=lot_id,
            prices_include_tax=sale.prices_include_tax,
        )

    refund = None
    if payload.refund_method is not None:
        refund = Refund(
            return_id=ret.id,
            amount=_q(refund_amount),
            method=payload.refund_method.value,
            status=RefundStatus.COMPLETED,
            processed_by_user_id=actor_id,
            created_at=occurred_at,
            completed_at=occurred_at,
        )
        session.add(refund)

    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="return",
        entity_id=ret.id,
        after={
            "sale_id": sale_id,
            "lines": len(payload.lines),
            "refund_amount": str(_q(refund_amount)),
            "refund_method": payload.refund_method.value if payload.refund_method else None,
            "refund_status": RefundStatus.COMPLETED if payload.refund_method else None,
        },
    )
    if refund is not None:
        await audit.record(
            session,
            action="completed",
            entity_type="refund",
            entity_id=refund.id,
            after={
                "return_id": ret.id,
                "amount": str(refund.amount),
                "method": refund.method,
                "status": refund.status,
                "completed_at": refund.completed_at.isoformat(),
            },
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
) -> Decimal:
    sale_line = lines_by_id[line_payload.sale_line_id]
    refund_base = line_payload.refund_quantity_packages * sale_line.package_factor
    stock_base = line_payload.stock_return_quantity_packages * sale_line.package_factor

    remaining_refundable = sale_line.quantity_base - sale_line.quantity_refunded
    remaining_physical = sale_line.quantity_base - sale_line.quantity_physically_returned
    if refund_base > remaining_refundable:
        raise _exceeded_error(
            sale_line,
            requested_packages=line_payload.refund_quantity_packages,
            remaining_base=remaining_refundable,
            dimension="reembolso",
        )
    if stock_base > remaining_physical:
        raise _exceeded_error(
            sale_line,
            requested_packages=line_payload.stock_return_quantity_packages,
            remaining_base=remaining_physical,
            dimension="reposición a stock",
        )

    # Cumulative-delta valuation makes returning a line in parts sum exactly
    # to returning that same quantity at once at NUMERIC(18,6) precision.
    refund_amount = Decimal(0)
    if refund_base > 0:
        before = _return_amount(
            sale_line,
            sale_line.quantity_refunded,
            prices_include_tax=prices_include_tax,
        )
        after = _return_amount(
            sale_line,
            sale_line.quantity_refunded + refund_base,
            prices_include_tax=prices_include_tax,
        )
        refund_amount = _q(after - before)

    movement_id: int | None = None
    if stock_base > 0 and sale_line.tracks_stock:
        movement = await inventory_service.record_movement(
            session,
            product_id=sale_line.product_id,
            warehouse_id=sale.warehouse_id,
            location_id=sale.location_id,
            lot_id=resolved_lot_id,
            quantity=stock_base,
            movement_type=MovementType.RETURN,
            unit_cost=sale_line.unit_cost,
            reference_type="return",
            reference_id=ret.id,
        )
        movement_id = movement.id

    sale_line.quantity_refunded += refund_base
    sale_line.quantity_physically_returned += stock_base
    session.add(
        ReturnLine(
            return_id=ret.id,
            sale_line_id=sale_line.id,
            product_id=sale_line.product_id,
            package_id=sale_line.package_id,
            package_name=sale_line.package_name,
            package_factor=sale_line.package_factor,
            refund_quantity_packages=line_payload.refund_quantity_packages,
            refund_quantity_base=refund_base,
            stock_return_quantity_packages=line_payload.stock_return_quantity_packages,
            stock_return_quantity_base=stock_base,
            refund_amount=refund_amount,
            lot_id=resolved_lot_id,
            stock_movement_id=movement_id,
        )
    )
    return refund_amount
