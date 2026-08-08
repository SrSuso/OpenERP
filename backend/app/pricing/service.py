"""Pricing: formula evaluation, price changes, and their history.

The exclusive write path for a product's cost/tax/surcharge/margin/price/
formula (see the note on ``app.catalog.schemas.ProductUpdate``) — every
change here writes a :class:`~app.pricing.models.ProductPriceHistory` row
in the same transaction, so the history can never miss one.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.catalog import service as catalog
from app.catalog.models import Product
from app.core.errors import NotFoundError, ValidationError
from app.pricing import formula
from app.pricing.formula import FormulaError
from app.pricing.models import ProductPriceHistory
from app.pricing.schemas import FormulaPreviewRequest, SetPricingInputsRequest


def _variables(product: Product) -> dict[str, Decimal]:
    return {
        "cost": product.cost,
        "tax_rate": product.tax_rate,
        "surcharge_rate": product.surcharge_rate,
        "margin_rate": product.margin_rate,
    }


def _snapshot(product: Product) -> dict[str, Any]:
    return {
        "cost": str(product.cost),
        "list_price": str(product.list_price),
        "tax_rate": str(product.tax_rate),
        "surcharge_rate": str(product.surcharge_rate),
        "margin_rate": str(product.margin_rate),
        "price_formula": product.price_formula,
    }


def preview(payload: FormulaPreviewRequest) -> Decimal:
    """Validate and evaluate a formula against arbitrary sample inputs —
    never touches the database."""
    try:
        return formula.evaluate(
            payload.formula,
            {
                "cost": payload.cost,
                "tax_rate": payload.tax_rate,
                "surcharge_rate": payload.surcharge_rate,
                "margin_rate": payload.margin_rate,
            },
        )
    except FormulaError as exc:
        raise ValidationError(str(exc)) from exc


async def _product_or_404(session: AsyncSession, product_id: int) -> Product:
    product = await session.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"Product {product_id} not found.")
    return product


async def _record_history(session: AsyncSession, product: Product) -> None:
    session.add(
        ProductPriceHistory(
            product_id=product.id,
            cost=product.cost,
            tax_rate=product.tax_rate,
            surcharge_rate=product.surcharge_rate,
            margin_rate=product.margin_rate,
            price_formula=product.price_formula,
            list_price=product.list_price,
        )
    )
    await session.flush()


async def list_price_history(session: AsyncSession, product_id: int) -> list[ProductPriceHistory]:
    await _product_or_404(session, product_id)
    stmt = (
        select(ProductPriceHistory)
        .where(ProductPriceHistory.product_id == product_id)
        .order_by(ProductPriceHistory.created_at.desc(), ProductPriceHistory.id.desc())
    )
    return list((await session.execute(stmt)).scalars())


async def set_pricing_inputs(
    session: AsyncSession, product_id: int, payload: SetPricingInputsRequest
) -> Product:
    """Update cost/tax/surcharge/margin. If a formula is set, the price is
    recomputed from it immediately — the point of a formula is that it
    stays true as its inputs change, not just at the moment it was typed."""
    product = await _product_or_404(session, product_id)
    before = _snapshot(product)

    if payload.cost is not None:
        product.cost = payload.cost
    if payload.tax_rate is not None:
        product.tax_rate = payload.tax_rate
    if payload.surcharge_rate is not None:
        product.surcharge_rate = payload.surcharge_rate
    if payload.margin_rate is not None:
        product.margin_rate = payload.margin_rate

    if product.price_formula:
        try:
            product.list_price = formula.evaluate(product.price_formula, _variables(product))
        except FormulaError as exc:
            raise ValidationError(str(exc)) from exc

    await session.flush()
    await _record_history(session, product)
    await audit.record(
        session,
        action="pricing_inputs_changed",
        entity_type="product",
        entity_id=product_id,
        before=before,
        after=_snapshot(product),
    )
    return await catalog.get_product(session, product_id)


async def set_price_formula(session: AsyncSession, product_id: int, formula_text: str) -> Product:
    try:
        formula.validate(formula_text)
    except FormulaError as exc:
        raise ValidationError(str(exc)) from exc

    product = await _product_or_404(session, product_id)
    before = _snapshot(product)
    product.price_formula = formula_text
    try:
        product.list_price = formula.evaluate(formula_text, _variables(product))
    except FormulaError as exc:
        raise ValidationError(str(exc)) from exc

    await session.flush()
    await _record_history(session, product)
    await audit.record(
        session,
        action="formula_set",
        entity_type="product",
        entity_id=product_id,
        before=before,
        after=_snapshot(product),
    )
    return await catalog.get_product(session, product_id)


async def clear_price_formula(session: AsyncSession, product_id: int) -> Product:
    """Reverts to manual pricing. ``list_price`` is left exactly as the
    formula last computed it — clearing the formula is not itself a price
    change, so it earns no new history row."""
    product = await _product_or_404(session, product_id)
    product.price_formula = None
    await session.flush()
    await audit.record(
        session,
        action="formula_cleared",
        entity_type="product",
        entity_id=product_id,
    )
    return await catalog.get_product(session, product_id)


async def set_manual_price(session: AsyncSession, product_id: int, list_price: Decimal) -> Product:
    """Sets ``list_price`` directly and clears any formula — a manual price
    always wins over a formula that would just overwrite it on the next
    input change."""
    product = await _product_or_404(session, product_id)
    before = _snapshot(product)
    product.price_formula = None
    product.list_price = list_price

    await session.flush()
    await _record_history(session, product)
    await audit.record(
        session,
        action="manual_price_set",
        entity_type="product",
        entity_id=product_id,
        before=before,
        after=_snapshot(product),
    )
    return await catalog.get_product(session, product_id)
