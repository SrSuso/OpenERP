"""The report builder's whitelist (rule 13, same spirit as
``app.dashboards.metrics``/``app.notifications.rules``): a fixed set of
"subjects", each with its own fixed dimension/metric keys, each backed by a
hand-written SQLAlchemy expression. A request only ever supplies *keys*
into these dicts — there is no path from a request body to a column name
or a fragment of SQL the database ever sees. Adding a dimension/metric
means adding an entry here, in code review, never something a saved
``ReportDefinition`` can grow on its own.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Any

from pydantic import BaseModel
from sqlalchemy import Select, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product
from app.core.business_time import business_date_expression, business_day_utc_range
from app.core.errors import ValidationError
from app.db.types import NUMERIC_EPSILON
from app.inventory.models import StockMovement, Warehouse
from app.purchasing.models import PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus
from app.sales.models import Sale, SaleLine, SaleStatus
from app.settings.business_time import get_business_timezone
from app.suppliers.models import Supplier


class ReportSubject(StrEnum):
    SALES = "SALES"
    PURCHASES = "PURCHASES"
    INVENTORY_MOVEMENTS = "INVENTORY_MOVEMENTS"


class ReportFilters(BaseModel):
    """One shared shape for every subject — a subject only ever reads the
    filter fields listed in its own ``filter_keys`` (see ``SubjectDef``
    below); sending one that doesn't apply is simply ignored, never an
    error, so the frontend can reuse one filters form."""

    date_from: date | None = None
    date_to: date | None = None
    warehouse_id: int | None = None
    category_id: int | None = None
    product_id: int | None = None
    supplier_id: int | None = None
    cashier_user_id: int | None = None
    movement_type: str | None = None


@dataclass(frozen=True)
class FieldDef:
    label: str
    #: Output column key -> SQL expression. More than one column (e.g. a
    #: product's SKU *and* name) can share one dimension/metric key so the
    #: frontend gets a readable label without a second round trip — every
    #: column here is both selected and, for dimensions, grouped by.
    #: SQLAlchemy accepts a plain column (``InstrumentedAttribute``) or a
    #: computed expression (``ColumnElement``) identically here — typed as
    #: ``Any`` rather than their common ancestor, which mypy does not treat
    #: as interchangeable with either.
    columns: dict[str, Any]
    #: This field is the subject's timestamp projected onto the configured
    #: commercial calendar.  Its SQL expression has to be built at runtime,
    #: once the store timezone is known.
    is_business_date: bool = False


@dataclass(frozen=True)
class SubjectDef:
    label: str
    dimensions: dict[str, FieldDef]
    metrics: dict[str, FieldDef]
    #: Absolute timestamp used for date grouping/filtering. It remains a
    #: TIMESTAMPTZ expression; only the projection to a business date varies.
    timestamp_expr: Any
    #: Adds select_from/joins/base "only this counts" filtering (e.g. only
    #: COMPLETED sales) to a ``select(...)`` that already has its columns.
    build_from: Callable[[Select[Any]], Select[Any]]
    #: Which ``ReportFilters`` fields this subject understands, each mapped
    #: to the condition it applies when present.
    filter_appliers: dict[str, Callable[[Any], Any]] = field(default_factory=dict)

    @property
    def filter_keys(self) -> list[str]:
        return [*self.filter_appliers.keys(), "date_from", "date_to"]


# --- ventas ------------------------------------------------------------------


def _sales_line_total() -> Any:
    """Same formula as ``app.sales.service.compute_line_totals`` /
    ``app.dashboards.metrics._line_total_expr`` — duplicated rather than
    imported, same as every module's own small ``_q``: each report module
    stays self-contained.

    The fiscal mode comes from the completed sale's own snapshot, never
    from the store's current pricing configuration."""
    remaining = SaleLine.quantity_base * SaleLine.unit_price * (1 - SaleLine.discount_rate / 100)
    return case(
        (Sale.prices_include_tax.is_(True), remaining),
        else_=remaining * (1 + SaleLine.tax_rate / 100),
    )


def _sales_build_from(stmt: Select[Any]) -> Select[Any]:
    return (
        stmt.select_from(SaleLine)
        .join(Sale, Sale.id == SaleLine.sale_id)
        .join(Warehouse, Warehouse.id == Sale.warehouse_id)
        .where(Sale.status == SaleStatus.COMPLETED)
    )


_SALES = SubjectDef(
    label="Ventas",
    dimensions={
        "date": FieldDef("Fecha", {}, is_business_date=True),
        "product": FieldDef(
            "Producto",
            {"product_sku": SaleLine.product_sku, "product_name": SaleLine.product_name},
        ),
        "category": FieldDef(
            "Categoría",
            {"category_name": func.coalesce(SaleLine.product_category_name, "Sin categoría")},
        ),
        "warehouse": FieldDef("Almacén", {"warehouse_name": Warehouse.name}),
        "cashier": FieldDef("Cajero", {"cashier_name": func.coalesce(Sale.cashier_name, "—")}),
    },
    metrics={
        "quantity": FieldDef(
            "Cantidad", {"quantity": func.coalesce(func.sum(SaleLine.quantity_base), 0)}
        ),
        "revenue": FieldDef(
            "Ingresos", {"revenue": func.coalesce(func.sum(_sales_line_total()), 0)}
        ),
        "tickets": FieldDef("Nº de tickets", {"tickets": func.count(func.distinct(Sale.id))}),
        "lines": FieldDef("Nº de líneas", {"lines": func.count(SaleLine.id)}),
    },
    timestamp_expr=Sale.completed_at,
    build_from=_sales_build_from,
    filter_appliers={
        "warehouse_id": lambda v: Sale.warehouse_id == v,
        "category_id": lambda v: SaleLine.product_category_id == v,
        "product_id": lambda v: SaleLine.product_id == v,
        "cashier_user_id": lambda v: Sale.cashier_user_id == v,
    },
)


# --- compras -------------------------------------------------------------------


def _purchases_build_from(stmt: Select[Any]) -> Select[Any]:
    return (
        stmt.select_from(PurchaseOrderLine)
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.purchase_order_id)
        .join(Product, Product.id == PurchaseOrderLine.product_id)
        .join(Supplier, Supplier.id == PurchaseOrder.supplier_id)
        .where(PurchaseOrder.status != PurchaseOrderStatus.CANCELLED)
    )


_PURCHASES_TIMESTAMP = func.coalesce(PurchaseOrder.ordered_at, PurchaseOrder.created_at)

_PURCHASES = SubjectDef(
    label="Compras",
    dimensions={
        "date": FieldDef("Fecha", {}, is_business_date=True),
        "product": FieldDef("Producto", {"product_sku": Product.sku, "product_name": Product.name}),
        "supplier": FieldDef("Proveedor", {"supplier_name": Supplier.name}),
    },
    metrics={
        "quantity": FieldDef(
            "Cantidad", {"quantity": func.coalesce(func.sum(PurchaseOrderLine.quantity_ordered), 0)}
        ),
        "cost": FieldDef(
            "Coste",
            {
                "cost": func.coalesce(
                    func.sum(PurchaseOrderLine.unit_cost * PurchaseOrderLine.quantity_packages), 0
                )
            },
        ),
        "lines": FieldDef("Nº de líneas", {"lines": func.count(PurchaseOrderLine.id)}),
        "orders": FieldDef(
            "Nº de pedidos", {"orders": func.count(func.distinct(PurchaseOrder.id))}
        ),
    },
    timestamp_expr=_PURCHASES_TIMESTAMP,
    build_from=_purchases_build_from,
    filter_appliers={
        "supplier_id": lambda v: PurchaseOrder.supplier_id == v,
        "product_id": lambda v: Product.id == v,
    },
)


# --- inventario (movimientos) -------------------------------------------------


def _movements_build_from(stmt: Select[Any]) -> Select[Any]:
    return (
        stmt.select_from(StockMovement)
        .join(Product, Product.id == StockMovement.product_id)
        .join(Warehouse, Warehouse.id == StockMovement.warehouse_id)
    )


_INVENTORY_MOVEMENTS = SubjectDef(
    label="Movimientos de inventario",
    dimensions={
        "date": FieldDef("Fecha", {}, is_business_date=True),
        "product": FieldDef("Producto", {"product_sku": Product.sku, "product_name": Product.name}),
        "warehouse": FieldDef("Almacén", {"warehouse_name": Warehouse.name}),
        "movement_type": FieldDef("Tipo", {"movement_type": StockMovement.movement_type}),
    },
    metrics={
        "quantity": FieldDef(
            "Cantidad (con signo)", {"quantity": func.coalesce(func.sum(StockMovement.quantity), 0)}
        ),
        "movements": FieldDef("Nº de movimientos", {"movements": func.count(StockMovement.id)}),
    },
    timestamp_expr=StockMovement.created_at,
    build_from=_movements_build_from,
    filter_appliers={
        "warehouse_id": lambda v: StockMovement.warehouse_id == v,
        "product_id": lambda v: StockMovement.product_id == v,
        "movement_type": lambda v: StockMovement.movement_type == v,
    },
)


SUBJECTS: dict[ReportSubject, SubjectDef] = {
    ReportSubject.SALES: _SALES,
    ReportSubject.PURCHASES: _PURCHASES,
    ReportSubject.INVENTORY_MOVEMENTS: _INVENTORY_MOVEMENTS,
}


def get_subject(subject: ReportSubject) -> SubjectDef:
    return SUBJECTS[subject]


async def run_report(
    session: AsyncSession,
    subject: ReportSubject,
    dimensions: list[str],
    metrics: list[str],
    filters: ReportFilters,
) -> tuple[list[str], list[dict[str, Any]]]:
    """Validates every key against this subject's whitelist, then builds
    and runs exactly one query from expressions that were already fixed at
    import time — never from anything in ``dimensions``/``metrics``/
    ``filters`` beyond which fixed entry they pick."""
    subject_def = SUBJECTS[subject]

    for key in dimensions:
        if key not in subject_def.dimensions:
            raise ValidationError(f"Unknown dimension {key!r} for subject {subject!r}.")
    for key in metrics:
        if key not in subject_def.metrics:
            raise ValidationError(f"Unknown metric {key!r} for subject {subject!r}.")
    if not metrics:
        raise ValidationError("At least one metric is required.")
    if (
        filters.date_from is not None
        and filters.date_to is not None
        and filters.date_from > filters.date_to
    ):
        raise ValidationError("date_from must not be after date_to.")

    select_exprs: list[Any] = []
    group_by_exprs: list[Any] = []
    output_keys: list[str] = []
    timezone = await get_business_timezone(session)
    date_expr = business_date_expression(subject_def.timestamp_expr, timezone)

    for dim_key in dimensions:
        field_def = subject_def.dimensions[dim_key]
        columns = {"date": date_expr} if field_def.is_business_date else field_def.columns
        for col_key, expr in columns.items():
            select_exprs.append(expr.label(col_key))
            group_by_exprs.append(expr)
            output_keys.append(col_key)
    for metric_key in metrics:
        for col_key, expr in subject_def.metrics[metric_key].columns.items():
            select_exprs.append(expr.label(col_key))
            output_keys.append(col_key)

    stmt = subject_def.build_from(select(*select_exprs))

    if filters.date_from is not None:
        start, _ = business_day_utc_range(filters.date_from, timezone)
        stmt = stmt.where(subject_def.timestamp_expr >= start)
    if filters.date_to is not None:
        _, end = business_day_utc_range(filters.date_to, timezone)
        stmt = stmt.where(subject_def.timestamp_expr < end)
    for filter_key, applier in subject_def.filter_appliers.items():
        value = getattr(filters, filter_key)
        if value is not None:
            stmt = stmt.where(applier(value))

    if group_by_exprs:
        stmt = stmt.group_by(*group_by_exprs).order_by(*group_by_exprs)

    rows = (await session.execute(stmt)).all()
    results: list[dict[str, Any]] = []
    for row in rows:
        record: dict[str, Any] = {}
        for key in output_keys:
            value = getattr(row, key)
            # A product of NUMERIC(18,6) columns yields extra decimal places
            # in SQL (e.g. quantity * unit_price) — quantize back to the
            # scale every other money/quantity value is presented at
            # (same rationale as every other module's own small ``_q``).
            record[key] = (
                str(value.quantize(NUMERIC_EPSILON)) if isinstance(value, Decimal) else value
            )
        results.append(record)
    return output_keys, results
