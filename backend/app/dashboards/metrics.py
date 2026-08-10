"""The whitelist itself (rule 13): a fixed set of metric keys, each backed
by its own typed Pydantic params model and its own hand-written, fully
parameterised SQLAlchemy query. There is no code path from a widget's
stored ``params`` JSON to a string of SQL — ``run_metric`` only ever picks
one of these Python functions by ``MetricKey`` and binds validated values
into a query that was already fixed at import time. Adding a metric means
adding a new key/params/query triple here, in code review, never something
a request body can grow on its own.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product
from app.core.errors import ValidationError
from app.db.types import NUMERIC_EPSILON
from app.inventory.models import StockBalance
from app.pricing.models import PricingSettings
from app.sales.models import Sale, SaleLine, SaleStatus


def _q(value: Decimal) -> Decimal:
    """Same rationale as every other service's ``_q``: multiplying two
    ``NUMERIC(18,6)`` columns in SQL yields extra decimal places (e.g.
    ``30.000000000000`` instead of ``30.000000``) — quantize back to the
    scale everything else in the API is presented at."""
    return value.quantize(NUMERIC_EPSILON)


class MetricKey(StrEnum):
    SALES_OVER_TIME = "sales_over_time"
    TOP_PRODUCTS = "top_products"
    STOCK_VALUE = "stock_value"
    LOW_STOCK_COUNT = "low_stock_count"


# --- params ------------------------------------------------------------------


class SalesOverTimeParams(BaseModel):
    date_from: date
    date_to: date
    warehouse_id: int | None = None


class TopProductsParams(BaseModel):
    date_from: date
    date_to: date
    warehouse_id: int | None = None
    limit: int = Field(default=10, ge=1, le=50)
    order_by: Literal["revenue", "quantity"] = "revenue"


class StockValueParams(BaseModel):
    warehouse_id: int | None = None


class LowStockCountParams(BaseModel):
    warehouse_id: int | None = None


PARAMS_BY_METRIC: dict[MetricKey, type[BaseModel]] = {
    MetricKey.SALES_OVER_TIME: SalesOverTimeParams,
    MetricKey.TOP_PRODUCTS: TopProductsParams,
    MetricKey.STOCK_VALUE: StockValueParams,
    MetricKey.LOW_STOCK_COUNT: LowStockCountParams,
}


def validate_params(metric: MetricKey, raw: dict[str, Any]) -> BaseModel:
    return PARAMS_BY_METRIC[metric].model_validate(raw)


# --- shared building blocks ----------------------------------------------------


def _line_total_expr() -> Any:
    """Same formula as ``app.sales.service.compute_line_totals``, expressed
    as a SQL arithmetic expression over ``sale_lines`` columns instead of
    Python — so it can be summed/grouped in the database without pulling
    every line into memory first.

    ``prices_include_tax`` (``app.pricing.models.PricingSettings``) is read
    live via a scalar subquery rather than threaded in as a Python
    argument — same technique ``app.reports.rules._sales_line_total`` needs
    (its subject definitions *are* frozen at import time, see that
    module's docstring), kept identical here rather than two different
    ways of reading the same setting."""
    remaining = SaleLine.quantity_base * SaleLine.unit_price * (1 - SaleLine.discount_rate / 100)
    prices_include_tax = select(PricingSettings.prices_include_tax).limit(1).scalar_subquery()
    return case(
        (prices_include_tax.is_(True), remaining),
        else_=remaining * (1 + SaleLine.tax_rate / 100),
    )


# --- metrics -------------------------------------------------------------------


async def sales_over_time(
    session: AsyncSession, params: SalesOverTimeParams
) -> list[dict[str, Any]]:
    if params.date_from > params.date_to:
        raise ValidationError("date_from must not be after date_to.")

    day = cast(Sale.completed_at, Date)
    stmt = (
        select(
            day.label("date"),
            func.count(func.distinct(Sale.id)).label("sales_count"),
            func.coalesce(func.sum(_line_total_expr()), 0).label("total"),
        )
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .where(
            Sale.status == SaleStatus.COMPLETED,
            day >= params.date_from,
            day <= params.date_to,
        )
        .group_by(day)
        .order_by(day)
    )
    if params.warehouse_id is not None:
        stmt = stmt.where(Sale.warehouse_id == params.warehouse_id)

    rows = (await session.execute(stmt)).all()
    return [
        {
            "date": row.date.isoformat(),
            "sales_count": row.sales_count,
            "total": str(_q(row.total)),
        }
        for row in rows
    ]


async def top_products(session: AsyncSession, params: TopProductsParams) -> list[dict[str, Any]]:
    if params.date_from > params.date_to:
        raise ValidationError("date_from must not be after date_to.")

    day = cast(Sale.completed_at, Date)
    revenue = func.coalesce(func.sum(_line_total_expr()), 0)
    quantity = func.coalesce(func.sum(SaleLine.quantity_base), 0)
    order_column = revenue if params.order_by == "revenue" else quantity

    stmt = (
        select(
            Product.id.label("product_id"),
            Product.sku.label("product_sku"),
            Product.name.label("product_name"),
            quantity.label("quantity"),
            revenue.label("revenue"),
        )
        .select_from(SaleLine)
        .join(Sale, Sale.id == SaleLine.sale_id)
        .join(Product, Product.id == SaleLine.product_id)
        .where(
            Sale.status == SaleStatus.COMPLETED,
            day >= params.date_from,
            day <= params.date_to,
        )
        .group_by(Product.id, Product.sku, Product.name)
        .order_by(order_column.desc())
        .limit(params.limit)
    )
    if params.warehouse_id is not None:
        stmt = stmt.where(Sale.warehouse_id == params.warehouse_id)

    rows = (await session.execute(stmt)).all()
    return [
        {
            "product_id": row.product_id,
            "product_sku": row.product_sku,
            "product_name": row.product_name,
            "quantity": str(_q(row.quantity)),
            "revenue": str(_q(row.revenue)),
        }
        for row in rows
    ]


async def stock_value(session: AsyncSession, params: StockValueParams) -> dict[str, Any]:
    stmt = select(func.coalesce(func.sum(StockBalance.quantity * Product.cost), 0)).join(
        Product, Product.id == StockBalance.product_id
    )
    if params.warehouse_id is not None:
        stmt = stmt.where(StockBalance.warehouse_id == params.warehouse_id)

    total: Decimal = (await session.execute(stmt)).scalar_one()
    return {"stock_value": str(_q(total))}


async def low_stock_count(session: AsyncSession, params: LowStockCountParams) -> dict[str, Any]:
    balance_stmt = select(
        StockBalance.product_id, func.sum(StockBalance.quantity).label("quantity")
    ).group_by(StockBalance.product_id)
    if params.warehouse_id is not None:
        balance_stmt = balance_stmt.where(StockBalance.warehouse_id == params.warehouse_id)
    balances = balance_stmt.subquery()

    stmt = (
        select(func.count())
        .select_from(Product)
        .outerjoin(balances, balances.c.product_id == Product.id)
        .where(
            Product.is_active.is_(True),
            Product.min_stock > 0,
            func.coalesce(balances.c.quantity, 0) < Product.min_stock,
        )
    )
    count: int = (await session.execute(stmt)).scalar_one()
    return {"low_stock_count": count}


_RUNNERS: dict[MetricKey, Any] = {
    MetricKey.SALES_OVER_TIME: sales_over_time,
    MetricKey.TOP_PRODUCTS: top_products,
    MetricKey.STOCK_VALUE: stock_value,
    MetricKey.LOW_STOCK_COUNT: low_stock_count,
}


async def run_metric(session: AsyncSession, metric: MetricKey, raw_params: dict[str, Any]) -> Any:
    """The only entry point that actually executes a metric — validates
    ``raw_params`` against that metric's own schema, then dispatches to its
    query function. Never called with anything but a ``MetricKey`` from the
    enum above, so there is no way to reach a query this module didn't
    define."""
    params = validate_params(metric, raw_params)
    return await _RUNNERS[metric](session, params)
