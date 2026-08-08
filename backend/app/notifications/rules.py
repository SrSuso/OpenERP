"""The rule whitelist itself — same shape as ``app.dashboards.metrics``:
one ``RuleType``, one Pydantic params model, one hand-written detector
query per type. ``evaluate_rules`` (in ``app.notifications.service``) can
only ever dispatch to one of these, never anything a rule's stored
``params`` JSON could turn into arbitrary SQL.

Each detector returns ``(subject_type, subject_id, message)`` triples for
whatever currently matches — deciding what to do with that list (open a
new incident, touch an existing one, resolve one that no longer matches)
is the service's job, not the detector's.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product
from app.inventory.models import StockBalance
from app.lots.models import Lot


class RuleType(StrEnum):
    LOW_STOCK = "LOW_STOCK"
    EXPIRING_LOT = "EXPIRING_LOT"


class LowStockParams(BaseModel):
    warehouse_id: int | None = None


class ExpiringLotParams(BaseModel):
    days_before_expiration: int = Field(default=7, ge=0, le=365)


PARAMS_BY_RULE_TYPE: dict[RuleType, type[BaseModel]] = {
    RuleType.LOW_STOCK: LowStockParams,
    RuleType.EXPIRING_LOT: ExpiringLotParams,
}


def validate_params(rule_type: RuleType, raw: dict[str, Any]) -> BaseModel:
    return PARAMS_BY_RULE_TYPE[rule_type].model_validate(raw)


@dataclass(frozen=True)
class Detection:
    subject_type: str
    subject_id: int
    message: str


async def _detect_low_stock(session: AsyncSession, params: LowStockParams) -> list[Detection]:
    balance_stmt = select(
        StockBalance.product_id, func.sum(StockBalance.quantity).label("quantity")
    ).group_by(StockBalance.product_id)
    if params.warehouse_id is not None:
        balance_stmt = balance_stmt.where(StockBalance.warehouse_id == params.warehouse_id)
    balances = balance_stmt.subquery()

    stmt = (
        select(
            Product.id,
            Product.sku,
            Product.name,
            func.coalesce(balances.c.quantity, 0).label("quantity"),
            Product.min_stock,
        )
        .select_from(Product)
        .outerjoin(balances, balances.c.product_id == Product.id)
        .where(
            Product.is_active.is_(True),
            Product.min_stock > 0,
            func.coalesce(balances.c.quantity, 0) < Product.min_stock,
        )
    )
    rows = (await session.execute(stmt)).all()
    return [
        Detection(
            subject_type="product",
            subject_id=row.id,
            message=(
                f"{row.sku} ({row.name}): quedan {row.quantity} unidades, "
                f"por debajo del mínimo ({row.min_stock})."
            ),
        )
        for row in rows
    ]


async def _detect_expiring_lots(
    session: AsyncSession, params: ExpiringLotParams
) -> list[Detection]:
    threshold = date.today() + timedelta(days=params.days_before_expiration)

    balance_stmt = (
        select(StockBalance.lot_id, func.sum(StockBalance.quantity).label("quantity"))
        .where(StockBalance.lot_id.is_not(None))
        .group_by(StockBalance.lot_id)
        .having(func.sum(StockBalance.quantity) > 0)
    )
    balances = balance_stmt.subquery()

    stmt = (
        select(Lot.id, Lot.lot_number, Lot.expiration_date, Product.sku)
        .join(Product, Product.id == Lot.product_id)
        .join(balances, balances.c.lot_id == Lot.id)
        .where(Lot.expiration_date.is_not(None), Lot.expiration_date <= threshold)
    )
    rows = (await session.execute(stmt)).all()
    return [
        Detection(
            subject_type="lot",
            subject_id=row.id,
            message=f"Lote {row.lot_number} de {row.sku} caduca el {row.expiration_date}.",
        )
        for row in rows
    ]


async def detect(
    session: AsyncSession, rule_type: RuleType, raw_params: dict[str, Any]
) -> list[Detection]:
    params = validate_params(rule_type, raw_params)
    if rule_type == RuleType.LOW_STOCK:
        assert isinstance(params, LowStockParams)
        return await _detect_low_stock(session, params)
    assert isinstance(params, ExpiringLotParams)
    return await _detect_expiring_lots(session, params)
