"""El cierre Z diario, actualizado explícitamente durante la jornada.

Cada almacén tiene una sola Z por día comercial. Al emitirla de nuevo se
recalculan, en ese mismo documento y número, todos los cobros y devoluciones
completados desde medianoche de la zona horaria de la tienda. Así una venta
posterior sigue perteneciendo a la Z del día, sin abrir un segundo cierre.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.core.business_time import business_date, business_day_utc_range
from app.core.context import get_user_id
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.types import NUMERIC_EPSILON
from app.idempotency import service as idempotency_service
from app.returns.models import Refund, RefundStatus, Return
from app.sales import accounting
from app.sales.models import Payment, PaymentMethod, Sale, SaleLine, SaleStatus, ZReport
from app.sales.service import compute_line_totals, payable
from app.settings.business_time import get_business_timezone

_CLOSE_OPERATION = "z_report.close"


def _q(value: Decimal) -> Decimal:
    return value.quantize(NUMERIC_EPSILON)


async def _last_close(session: AsyncSession, warehouse_id: int) -> ZReport | None:
    return (
        await session.execute(
            select(ZReport)
            .where(ZReport.warehouse_id == warehouse_id)
            .order_by(ZReport.number.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _business_day_window(
    session: AsyncSession, instant: datetime
) -> tuple[datetime, datetime]:
    timezone = await get_business_timezone(session)
    return business_day_utc_range(business_date(instant, timezone), timezone)


async def _report_for_business_day(
    session: AsyncSession, warehouse_id: int, *, start: datetime, end: datetime
) -> ZReport | None:
    return (
        await session.execute(
            select(ZReport)
            .where(
                ZReport.warehouse_id == warehouse_id,
                ZReport.closed_at >= start,
                ZReport.closed_at < end,
            )
            .order_by(ZReport.closed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def open_sales(session: AsyncSession, warehouse_id: int) -> list[Sale]:
    """Las ventas a medias que impiden cerrar: las que tienen algo dentro.

    Un borrador **vacío** no cuenta, y esto no es un detalle: la caja abre
    uno sola en cuanto se queda sin ninguno (para que recargar la página no
    deje a nadie sin carrito), así que contándolos no habría forma humana
    de cerrar el turno — se cancela el vacío y aparece otro. Y tampoco hay
    nada que cuadrar en un carrito sin líneas: no se va a cobrar.
    """
    stmt = (
        select(Sale)
        .where(Sale.warehouse_id == warehouse_id, Sale.status == SaleStatus.DRAFT)
        .options(selectinload(Sale.lines))
        .order_by(Sale.id)
    )
    return [sale for sale in (await session.execute(stmt)).scalars() if sale.lines]


async def preview(
    session: AsyncSession, warehouse_id: int
) -> tuple[dict[str, object], ZReport | None]:
    """Los totales vivos de hoy y, si existe, su único documento Z."""
    now = await accounting.database_clock(session)
    start, end = await _business_day_window(session, now)
    existing = await _report_for_business_day(session, warehouse_id, start=start, end=end)
    return await _totals(session, warehouse_id, since=start, until=now), existing


async def _totals(
    session: AsyncSession,
    warehouse_id: int,
    *,
    since: datetime | None,
    until: datetime | None = None,
) -> dict[str, object]:
    sales_stmt = select(Sale).where(
        Sale.warehouse_id == warehouse_id, Sale.status == SaleStatus.COMPLETED
    )
    if since is not None:
        sales_stmt = sales_stmt.where(Sale.completed_at >= since)
    if until is not None:
        sales_stmt = sales_stmt.where(Sale.completed_at <= until)
    sales = list((await session.execute(sales_stmt)).scalars())
    sale_ids = [sale.id for sale in sales]
    fiscal_mode_by_sale = {sale.id: sale.prices_include_tax for sale in sales}

    gross = tax = discount = Decimal(0)
    by_method = {method: Decimal(0) for method in PaymentMethod}

    if sale_ids:
        totals_by_sale: dict[int, Decimal] = dict.fromkeys(sale_ids, Decimal(0))
        lines = (
            await session.execute(select(SaleLine).where(SaleLine.sale_id.in_(sale_ids)))
        ).scalars()
        for line in lines:
            prices_include_tax = fiscal_mode_by_sale[line.sale_id]
            assert prices_include_tax is not None  # completed-sale DB invariant
            amounts = compute_line_totals(line, prices_include_tax=prices_include_tax)
            tax += amounts.tax_amount
            discount += amounts.discount_amount
            totals_by_sale[line.sale_id] += amounts.total

        # Redondeado por venta, no al final: es lo que se cobró en cada una
        # (ver `payable`), y lo que tiene que cuadrar con el cajón.
        for sale_id, sale_total in totals_by_sale.items():
            totals_by_sale[sale_id] = payable(sale_total)
        gross = sum(totals_by_sale.values(), Decimal(0))

        tendered_by_sale: dict[int, dict[PaymentMethod, Decimal]] = {
            sale_id: {method: Decimal(0) for method in PaymentMethod} for sale_id in sale_ids
        }
        payments = (
            await session.execute(select(Payment).where(Payment.sale_id.in_(sale_ids)))
        ).scalars()
        for payment in payments:
            tendered_by_sale[payment.sale_id][PaymentMethod(payment.method)] += payment.amount

        for sale_id, tendered in tendered_by_sale.items():
            # Lo guardado en cada pago es lo que **entregó el cliente**, y en
            # efectivo eso suele ser de más: la vuelta sale del cajón. Un
            # billete de 20 por una compra de 12,40 deja 12,40 en el cajón, no
            # 20 — contar lo entregado descuadraría por el importe del cambio
            # justo en el papel que sirve para contarlo. La vuelta sólo puede
            # darse en efectivo (lo impone `checkout`), así que se descuenta
            # de ahí.
            change = max(Decimal(0), sum(tendered.values()) - totals_by_sale[sale_id])
            for method, amount in tendered.items():
                by_method[method] += amount - change if method is PaymentMethod.CASH else amount

    # Only completed economic effects belong in the Z. A physical-only
    # goodwill exchange has no Refund row and cannot reduce the till.
    refunds_stmt = (
        select(Refund)
        .join(Return, Return.id == Refund.return_id)
        .join(Sale, Sale.id == Return.sale_id)
        .where(
            Sale.warehouse_id == warehouse_id,
            Refund.status == RefundStatus.COMPLETED,
        )
    )
    if since is not None:
        refunds_stmt = refunds_stmt.where(Refund.completed_at >= since)
    if until is not None:
        refunds_stmt = refunds_stmt.where(Refund.completed_at <= until)
    refunds = list((await session.execute(refunds_stmt)).scalars())
    returns_total = sum((refund.amount for refund in refunds), Decimal(0))

    return {
        "covers_from": since,
        "sales_count": len(sales),
        "gross_total": _q(gross),
        "tax_total": _q(tax),
        "discount_total": _q(discount),
        "cash_total": _q(by_method[PaymentMethod.CASH]),
        "card_total": _q(by_method[PaymentMethod.CARD]),
        "other_total": _q(by_method[PaymentMethod.OTHER]),
        "returns_count": len(refunds),
        "returns_total": _q(returns_total),
    }


def close_request_fingerprint(warehouse_id: int) -> str:
    canonical = json.dumps({"warehouse_id": warehouse_id}, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def get_report(session: AsyncSession, report_id: int) -> ZReport:
    report = await session.get(ZReport, report_id)
    if report is None:
        raise NotFoundError(f"Z report {report_id} not found.")
    return report


async def close(
    session: AsyncSession,
    warehouse_id: int,
    *,
    idempotency_key: str | None = None,
    actor_user_id: int | None = None,
) -> ZReport:
    """Crea o actualiza la única Z diaria con todos los efectos de hoy."""
    claim = None
    closing_user_id = actor_user_id if actor_user_id is not None else get_user_id()
    if idempotency_key is not None:
        if closing_user_id is None:
            raise ValidationError("An authenticated user is required for an idempotent Z close.")
        claim = await idempotency_service.claim(
            session,
            operation=_CLOSE_OPERATION,
            idempotency_key=idempotency_key,
            request_fingerprint=close_request_fingerprint(warehouse_id),
            resource_id=warehouse_id,
            actor_user_id=closing_user_id,
        )
        if not claim.is_new:
            if claim.record.result_resource_id is None:
                raise ConflictError("The idempotent Z report result is not available.")
            return await get_report(session, claim.record.result_resource_id)

    await accounting.lock_warehouse_cut(session, warehouse_id)
    closed_at = await accounting.database_clock(session)
    day_start, day_end = await _business_day_window(session, closed_at)
    pending = await open_sales(session, warehouse_id)
    if pending:
        numbers = ", ".join(f"#{sale.id}" for sale in pending)
        raise ConflictError(
            f"Hay {len(pending)} venta(s) sin cobrar en esta caja ({numbers}). Cóbralas "
            "o cancélalas antes de cerrar: si no, se cobrarían después del cierre diario y "
            "no cuadrarían la Z."
        )

    totals = await _totals(
        session,
        warehouse_id,
        since=day_start,
        until=closed_at,
    )

    existing = await _report_for_business_day(session, warehouse_id, start=day_start, end=day_end)
    if existing is not None:
        existing.closed_at = closed_at
        existing.closed_by_user_id = closing_user_id
        for field, value in totals.items():
            setattr(existing, field, value)
        await session.flush()
        await audit.record(
            session,
            action="updated",
            entity_type="z_report",
            entity_id=existing.id,
            after={
                "number": existing.number,
                "warehouse_id": warehouse_id,
                "sales_count": existing.sales_count,
                "gross_total": str(existing.gross_total),
            },
        )
        if claim is not None:
            await idempotency_service.complete(
                session, claim.record, result_resource_id=existing.id
            )
        return existing

    last = await _last_close(session, warehouse_id)

    report = ZReport(
        warehouse_id=warehouse_id,
        number=(last.number + 1) if last else 1,
        closed_at=closed_at,
        closed_by_user_id=closing_user_id,
        **totals,
    )
    session.add(report)
    await session.flush()
    await audit.record(
        session,
        action="closed",
        entity_type="z_report",
        entity_id=report.id,
        after={
            "number": report.number,
            "warehouse_id": warehouse_id,
            "sales_count": report.sales_count,
            "gross_total": str(report.gross_total),
        },
    )
    if claim is not None:
        await idempotency_service.complete(session, claim.record, result_resource_id=report.id)
    return report


async def list_reports(
    session: AsyncSession, *, warehouse_id: int | None = None, limit: int = 100
) -> list[ZReport]:
    stmt = select(ZReport).order_by(ZReport.closed_at.desc()).limit(limit)
    if warehouse_id is not None:
        stmt = stmt.where(ZReport.warehouse_id == warehouse_id)
    return list((await session.execute(stmt)).scalars())
