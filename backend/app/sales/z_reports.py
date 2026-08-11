"""El cierre de caja (la Z de totales).

Cerrar sesión en el TPV sin haber cuadrado el cajón deja el turno sin
cerrar y sin nada con que reconciliarlo al día siguiente, así que la caja
exige hacer la Z antes de salir. Aquí se calculan y se congelan sus
totales; el TPV sólo la pide, la enseña y la imprime.

Dos reglas que la hacen fiable:

* El turno va **del cierre anterior a éste**, no "de hoy": si un día se
  cierra a las ocho y otro a las dos de la mañana, seguir por fechas
  dejaría ventas fuera de toda Z o dentro de dos. Encadenando por el
  `closed_at` anterior no hay huecos ni solapes.
* No se cierra con una venta a medias. Un carrito abierto acabará
  cobrándose *después* del corte, así que quedaría fuera de esta Z y
  dentro de la siguiente, cuadrando mal las dos.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.core.context import get_user_id
from app.core.errors import ConflictError
from app.db.types import NUMERIC_EPSILON
from app.pricing.models import PricingSettings
from app.returns.models import Return, ReturnLine
from app.sales.models import Payment, PaymentMethod, Sale, SaleLine, SaleStatus, ZReport
from app.sales.service import compute_line_totals


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


async def open_sales(session: AsyncSession, warehouse_id: int) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(Sale)
            .where(Sale.warehouse_id == warehouse_id, Sale.status == SaleStatus.DRAFT)
        )
    ).scalar_one()


async def preview(session: AsyncSession, warehouse_id: int) -> dict[str, object]:
    """Los totales que tendría la Z si se cerrase ahora, sin guardar nada —
    lo que el TPV enseña antes de que se confirme el cierre."""
    last = await _last_close(session, warehouse_id)
    return await _totals(session, warehouse_id, since=last.closed_at if last else None)


async def _totals(
    session: AsyncSession, warehouse_id: int, *, since: datetime | None
) -> dict[str, object]:
    settings = (await session.execute(select(PricingSettings).limit(1))).scalar_one_or_none()
    prices_include_tax = settings.prices_include_tax if settings else False

    sales_stmt = select(Sale).where(
        Sale.warehouse_id == warehouse_id, Sale.status == SaleStatus.COMPLETED
    )
    if since is not None:
        sales_stmt = sales_stmt.where(Sale.completed_at > since)
    sales = list((await session.execute(sales_stmt)).scalars())
    sale_ids = [sale.id for sale in sales]

    gross = tax = discount = Decimal(0)
    if sale_ids:
        lines = (
            await session.execute(select(SaleLine).where(SaleLine.sale_id.in_(sale_ids)))
        ).scalars()
        for line in lines:
            totals = compute_line_totals(line, prices_include_tax=prices_include_tax)
            gross += totals.total
            tax += totals.tax_amount
            discount += totals.discount_amount

    by_method = {method: Decimal(0) for method in PaymentMethod}
    if sale_ids:
        payments = (
            await session.execute(select(Payment).where(Payment.sale_id.in_(sale_ids)))
        ).scalars()
        for payment in payments:
            by_method[PaymentMethod(payment.method)] += payment.amount

    # Las devoluciones del turno se cuentan por cuándo se hicieron, no por
    # cuándo se vendió lo devuelto: el dinero sale del cajón hoy aunque la
    # compra fuera de la semana pasada.
    returns_stmt = select(Return)
    if since is not None:
        returns_stmt = returns_stmt.where(Return.created_at > since)
    returns = list((await session.execute(returns_stmt)).scalars())
    returns_total = Decimal(0)
    if returns:
        refund_lines = (
            await session.execute(
                select(ReturnLine).where(ReturnLine.return_id.in_([r.id for r in returns]))
            )
        ).scalars()
        for refund in refund_lines:
            returns_total += refund.refund_amount

    return {
        "covers_from": since,
        "sales_count": len(sales),
        "gross_total": _q(gross),
        "tax_total": _q(tax),
        "discount_total": _q(discount),
        "cash_total": _q(by_method[PaymentMethod.CASH]),
        "card_total": _q(by_method[PaymentMethod.CARD]),
        "other_total": _q(by_method[PaymentMethod.OTHER]),
        "returns_count": len(returns),
        "returns_total": _q(returns_total),
    }


async def close(session: AsyncSession, warehouse_id: int) -> ZReport:
    """Cierra el turno: calcula los totales, los congela y los numera."""
    pending = await open_sales(session, warehouse_id)
    if pending:
        raise ConflictError(
            f"Hay {pending} venta(s) sin cobrar en esta caja. Cóbralas o cancélalas "
            "antes de cerrar: si no, se cobrarían después del corte y no cuadraría "
            "ni esta Z ni la siguiente."
        )

    last = await _last_close(session, warehouse_id)
    totals = await _totals(session, warehouse_id, since=last.closed_at if last else None)

    report = ZReport(
        warehouse_id=warehouse_id,
        number=(last.number + 1) if last else 1,
        closed_at=datetime.now(UTC),
        closed_by_user_id=get_user_id(),
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
    return report


async def list_reports(
    session: AsyncSession, *, warehouse_id: int | None = None, limit: int = 100
) -> list[ZReport]:
    stmt = select(ZReport).order_by(ZReport.closed_at.desc()).limit(limit)
    if warehouse_id is not None:
        stmt = stmt.where(ZReport.warehouse_id == warehouse_id)
    return list((await session.execute(stmt)).scalars())
