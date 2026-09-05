"""Resumen X vivo y cierre Z final de una jornada comercial.

El X nunca se guarda: es una consulta/imprimible de cómo va la caja. La Z se
emite una vez al acabar la jornada, guarda todos sus desgloses como snapshot y
bloquea nuevos cobros y devoluciones económicas de ese almacén hasta el día
siguiente. No se usa una Z actualizable como sustituto de ese documento final.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
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
from app.inventory.models import Warehouse
from app.pos.models import PosTerminal
from app.returns.models import Refund, RefundStatus, Return
from app.sales import accounting
from app.sales.models import Payment, PaymentMethod, Sale, SaleLine, SaleStatus, ZReport
from app.sales.service import compute_line_totals, payable
from app.settings.business_time import get_business_timezone
from app.tickets.models import TicketTemplate
from app.users.models import User

_CLOSE_OPERATION = "z_report.close"
_PAYMENT_METHODS = (PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.OTHER)


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
    session: AsyncSession, warehouse_id: int, *, business_day: date
) -> ZReport | None:
    return (
        await session.execute(
            select(ZReport)
            .where(
                ZReport.warehouse_id == warehouse_id,
                ZReport.business_date == business_day,
            )
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
    """El X vivo de hoy y, si ya existe, su Z final inalterable."""
    now = await accounting.database_clock(session)
    start, _end = await _business_day_window(session, now)
    timezone = await get_business_timezone(session)
    business_day = business_date(now, timezone)
    existing = await _report_for_business_day(session, warehouse_id, business_day=business_day)
    totals = await _totals(session, warehouse_id, since=start, until=now)
    totals.update(
        {
            "warehouse_id": warehouse_id,
            "warehouse_name": await _warehouse_name(session, warehouse_id),
            "business_date": business_day,
            "generated_at": now,
        }
    )
    return totals, existing if existing is not None and existing.is_final else None


async def _warehouse_name(session: AsyncSession, warehouse_id: int) -> str:
    warehouse = await session.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFoundError(f"Warehouse {warehouse_id} not found.")
    return warehouse.name


def _amount(value: Decimal) -> str:
    """A JSON snapshot must never receive a Decimal or a float."""
    return format(_q(value), "f")


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
    tax_by_rate: dict[Decimal, dict[str, Decimal]] = {}
    totals_by_sale: dict[int, Decimal] = {}

    if sale_ids:
        totals_by_sale = dict.fromkeys(sale_ids, Decimal(0))
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
            rate_totals = tax_by_rate.setdefault(
                line.tax_rate,
                {"taxable_base": Decimal(0), "tax_amount": Decimal(0), "total": Decimal(0)},
            )
            rate_totals["taxable_base"] += amounts.total - amounts.tax_amount
            rate_totals["tax_amount"] += amounts.tax_amount
            rate_totals["total"] += amounts.total

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
    refunded_by_method: dict[str, Decimal] = {
        method.value: Decimal(0) for method in _PAYMENT_METHODS
    }
    refunded_by_method["UNKNOWN"] = Decimal(0)
    for refund in refunds:
        method_key: str = refund.method if refund.method in refunded_by_method else "UNKNOWN"
        refunded_by_method[method_key] += refund.amount

    terminal_names: dict[int, str] = {}
    terminal_ids = {sale.terminal_id for sale in sales if sale.terminal_id is not None}
    if terminal_ids:
        terminal_rows = (
            await session.execute(
                select(PosTerminal.id, PosTerminal.name).where(PosTerminal.id.in_(terminal_ids))
            )
        ).all()
        terminal_names = {row[0]: row[1] for row in terminal_rows}
    by_terminal: dict[tuple[int | None, str], dict[str, Decimal | int]] = {}
    by_cashier: dict[tuple[int | None, str], dict[str, Decimal | int]] = {}
    for sale in sales:
        sale_total = totals_by_sale[sale.id]
        terminal_key = (
            sale.terminal_id,
            terminal_names.get(sale.terminal_id or -1, "Sin terminal"),
        )
        terminal = by_terminal.setdefault(
            terminal_key, {"sales_count": 0, "gross_total": Decimal(0)}
        )
        terminal["sales_count"] = int(terminal["sales_count"]) + 1
        terminal["gross_total"] = Decimal(terminal["gross_total"]) + sale_total
        cashier_key = (sale.cashier_user_id, sale.cashier_name or "Sin cajero")
        cashier = by_cashier.setdefault(cashier_key, {"sales_count": 0, "gross_total": Decimal(0)})
        cashier["sales_count"] = int(cashier["sales_count"]) + 1
        cashier["gross_total"] = Decimal(cashier["gross_total"]) + sale_total

    tax_breakdown = [
        {
            "rate": _amount(rate),
            "taxable_base": _amount(values["taxable_base"]),
            "tax_amount": _amount(values["tax_amount"]),
            "total": _amount(values["total"]),
        }
        for rate, values in sorted(tax_by_rate.items())
    ]
    payment_breakdown = [
        {
            "method": method.value,
            "collected_total": _amount(by_method[method]),
            "refunded_total": _amount(refunded_by_method[method.value]),
            "net_total": _amount(by_method[method] - refunded_by_method[method.value]),
        }
        for method in _PAYMENT_METHODS
    ]
    if refunded_by_method["UNKNOWN"]:
        payment_breakdown.append(
            {
                "method": "UNKNOWN",
                "collected_total": _amount(Decimal(0)),
                "refunded_total": _amount(refunded_by_method["UNKNOWN"]),
                "net_total": _amount(-refunded_by_method["UNKNOWN"]),
            }
        )
    terminal_breakdown = [
        {
            "terminal_id": terminal_id,
            "terminal_name": name,
            "sales_count": int(values["sales_count"]),
            "gross_total": _amount(Decimal(values["gross_total"])),
        }
        for (terminal_id, name), values in sorted(
            by_terminal.items(), key=lambda item: (item[0][1], item[0][0] or 0)
        )
    ]
    cashier_breakdown = [
        {
            "cashier_user_id": cashier_id,
            "cashier_name": name,
            "sales_count": int(values["sales_count"]),
            "gross_total": _amount(Decimal(values["gross_total"])),
        }
        for (cashier_id, name), values in sorted(
            by_cashier.items(), key=lambda item: (item[0][1], item[0][0] or 0)
        )
    ]
    ticket_numbers = [sale.number for sale in sales if sale.number is not None]

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
        "first_sale_number": min(ticket_numbers) if ticket_numbers else None,
        "last_sale_number": max(ticket_numbers) if ticket_numbers else None,
        "tax_breakdown": tax_breakdown,
        "payment_breakdown": payment_breakdown,
        "terminal_breakdown": terminal_breakdown,
        "cashier_breakdown": cashier_breakdown,
    }


async def assert_business_day_open(
    session: AsyncSession, warehouse_id: int, occurred_at: datetime
) -> None:
    """Reject an economic operation after its final Z, under the same cut lock."""
    timezone = await get_business_timezone(session)
    report = await _report_for_business_day(
        session, warehouse_id, business_day=business_date(occurred_at, timezone)
    )
    if report is not None and report.is_final:
        raise ConflictError(
            "La jornada ya tiene una Z definitiva. No se pueden cobrar ventas ni registrar "
            "devoluciones económicas hasta la siguiente jornada comercial."
        )


def close_request_fingerprint(warehouse_id: int) -> str:
    canonical = json.dumps({"warehouse_id": warehouse_id}, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def get_report(session: AsyncSession, report_id: int) -> ZReport:
    report = await session.get(ZReport, report_id)
    if report is None:
        raise NotFoundError(f"Z report {report_id} not found.")
    return report


async def _identity_snapshot(
    session: AsyncSession, warehouse_id: int, closing_user_id: int | None
) -> dict[str, object]:
    """Freeze the issuer, place and closer alongside the financial totals."""
    warehouse = await session.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFoundError(f"Warehouse {warehouse_id} not found.")
    template = await session.scalar(
        select(TicketTemplate).where(TicketTemplate.is_active.is_(True))
    )
    user = await session.get(User, closing_user_id) if closing_user_id is not None else None
    return {
        "warehouse_name": warehouse.name,
        "store_name": template.store_name if template is not None else "",
        "store_tax_id": template.store_tax_id if template is not None else "",
        "store_address": template.store_address if template is not None else "",
        "closed_by_name": user.full_name if user is not None else None,
    }


async def close(
    session: AsyncSession,
    warehouse_id: int,
    *,
    idempotency_key: str | None = None,
    actor_user_id: int | None = None,
) -> ZReport:
    """Finalize the one immutable Z for this warehouse and business day."""
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
    day_start, _day_end = await _business_day_window(session, closed_at)
    timezone = await get_business_timezone(session)
    current_business_day = business_date(closed_at, timezone)
    pending = await open_sales(session, warehouse_id)
    if pending:
        numbers = ", ".join(f"#{sale.id}" for sale in pending)
        raise ConflictError(
            f"Hay {len(pending)} venta(s) sin cobrar en esta caja ({numbers}). Cóbralas "
            "o cancélalas antes de emitir la Z definitiva."
        )

    totals = await _totals(
        session,
        warehouse_id,
        since=day_start,
        until=closed_at,
    )

    existing = await _report_for_business_day(
        session, warehouse_id, business_day=current_business_day
    )
    if existing is not None:
        if existing.is_final:
            raise ConflictError(
                f"La Z nº {existing.number} de esta jornada ya es definitiva y no se puede "
                "modificar."
            )
        # A pre-existing report comes from the historical, mutable-Z
        # implementation. It becomes one final snapshot at the first close
        # after this migration; later calls are rejected like every new Z.
        existing.closed_at = closed_at
        existing.closed_by_user_id = closing_user_id
        existing.business_date = current_business_day
        existing.is_final = True
        existing.finalized_at = closed_at
        for field, value in totals.items():
            setattr(existing, field, value)
        identity = await _identity_snapshot(session, warehouse_id, closing_user_id)
        for field, value in identity.items():
            setattr(existing, field, value)
        await session.flush()
        await audit.record(
            session,
            action="finalized_legacy",
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
        business_date=current_business_day,
        closed_at=closed_at,
        is_final=True,
        finalized_at=closed_at,
        closed_by_user_id=closing_user_id,
        **totals,
        **(await _identity_snapshot(session, warehouse_id, closing_user_id)),
    )
    session.add(report)
    await session.flush()
    await audit.record(
        session,
        action="finalized",
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
    # Los documentos antiguos eran resúmenes mutables. No se presentan como
    # cierres Z definitivos; quedan conservados en base de datos para auditoría
    # y sólo el primer cierre posterior puede consolidarlos.
    stmt = (
        select(ZReport)
        .where(ZReport.is_final.is_(True))
        .order_by(ZReport.closed_at.desc())
        .limit(limit)
    )
    if warehouse_id is not None:
        stmt = stmt.where(ZReport.warehouse_id == warehouse_id)
    return list((await session.execute(stmt)).scalars())
