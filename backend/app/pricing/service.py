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
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog import service as catalog
from app.catalog.models import Product, ProductCategory
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.pricing import formula
from app.pricing.formula import FormulaError
from app.pricing.models import PricingSettings, ProductPriceHistory, Tax
from app.pricing.schemas import (
    CategoryPricingUpdate,
    FormulaPreviewRequest,
    PricingSettingsUpdate,
    SetPricingInputsRequest,
    TaxCreate,
)


def effective_tax_rate(product: Product) -> Decimal:
    """A product's own `taxes` win if it has any; otherwise its category's;
    otherwise the legacy scalar `Product.tax_rate` — which is what every
    product created before this feature existed, or that has never touched
    the new Tax entities, already carries (keeps the formula correct for
    them without special-casing "the tax system isn't in use here")."""
    if product.taxes:
        return sum((t.rate for t in product.taxes if t.is_active), Decimal(0))
    if product.category is not None and product.category.taxes:
        return sum((t.rate for t in product.category.taxes if t.is_active), Decimal(0))
    return product.tax_rate


def effective_margin_rate(product: Product) -> Decimal:
    """``None`` = inherit — see `Product.margin_rate`'s own docstring."""
    if product.margin_rate is not None:
        return product.margin_rate
    if product.category is not None and product.category.margin_rate is not None:
        return product.category.margin_rate
    return Decimal(0)


def _variables(product: Product) -> dict[str, Decimal]:
    return {
        "cost": product.cost,
        "tax_rate": effective_tax_rate(product),
        "surcharge_rate": product.surcharge_rate,
        "margin_rate": effective_margin_rate(product),
    }


def _snapshot(product: Product) -> dict[str, Any]:
    return {
        "cost": str(product.cost),
        "list_price": str(product.list_price),
        "tax_rate": str(product.tax_rate),
        "surcharge_rate": str(product.surcharge_rate),
        "margin_rate": str(product.margin_rate) if product.margin_rate is not None else None,
        "tax_ids": sorted(t.id for t in product.taxes),
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


#: Everything effective_tax_rate/effective_margin_rate need loaded —
#: without this, touching `product.taxes`/`product.category` from an
#: async session outside a request already holding them raises instead of
#: lazy-loading.
_PRODUCT_PRICING_OPTIONS = (
    selectinload(Product.taxes),
    selectinload(Product.category).selectinload(ProductCategory.taxes),
)


async def _product_or_404(session: AsyncSession, product_id: int) -> Product:
    stmt = (
        select(Product)
        .where(Product.id == product_id)
        .options(*_PRODUCT_PRICING_OPTIONS)
        .execution_options(populate_existing=True)
    )
    product = (await session.execute(stmt)).scalar_one_or_none()
    if product is None:
        raise NotFoundError(f"Product {product_id} not found.")
    return product


async def _record_history(session: AsyncSession, product: Product) -> None:
    """Records the *effective* tax/margin actually used for this price —
    not the raw (possibly ``None``/inherited) columns — so a history row
    always shows what really went into computing that ``list_price``."""
    session.add(
        ProductPriceHistory(
            product_id=product.id,
            cost=product.cost,
            tax_rate=effective_tax_rate(product),
            surcharge_rate=product.surcharge_rate,
            margin_rate=effective_margin_rate(product),
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


async def _taxes_by_id(session: AsyncSession, tax_ids: list[int]) -> list[Tax]:
    if not tax_ids:
        return []
    stmt = select(Tax).where(Tax.id.in_(tax_ids))
    taxes = list((await session.execute(stmt)).scalars())
    missing = set(tax_ids) - {t.id for t in taxes}
    if missing:
        raise ValidationError(f"Unknown tax ids: {sorted(missing)}")
    return taxes


def _recompute_with(product: Product, settings: PricingSettings) -> None:
    """Evaluates the product's own formula, or the store-wide default if
    it has none, against its *effective* inputs — the actual "PVP
    calculado automáticamente" the margin/tax panels trigger."""
    text = product.price_formula or settings.formula
    try:
        product.list_price = formula.evaluate(text, _variables(product))
    except FormulaError as exc:
        raise ValidationError(str(exc)) from exc


async def set_pricing_inputs(
    session: AsyncSession, product_id: int, payload: SetPricingInputsRequest
) -> Product:
    """Update cost/tax/surcharge/margin/taxes.

    ``cost``/``tax_rate``/``surcharge_rate`` only recompute the price if
    the product already has its own formula (unchanged since phase 4 —
    a manually-priced product stays manually priced through a cost
    change). ``margin_rate``/``tax_ids`` are new and always recompute,
    using the store's default formula if the product has none of its own
    — see this module's own docstring and `SetPricingInputsRequest`'s.
    """
    product = await _product_or_404(session, product_id)
    before = _snapshot(product)
    touched_margin_or_tax = False

    if payload.cost is not None:
        product.cost = payload.cost
    if payload.tax_rate is not None:
        product.tax_rate = payload.tax_rate
    if payload.surcharge_rate is not None:
        product.surcharge_rate = payload.surcharge_rate
    if "margin_rate" in payload.model_fields_set:
        product.margin_rate = payload.margin_rate
        touched_margin_or_tax = True
    if "tax_ids" in payload.model_fields_set:
        product.taxes = await _taxes_by_id(session, payload.tax_ids or [])
        touched_margin_or_tax = True

    if product.price_formula or touched_margin_or_tax:
        _recompute_with(product, await get_settings(session))

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


# --- taxes -----------------------------------------------------------------


async def list_taxes(session: AsyncSession) -> list[Tax]:
    stmt = select(Tax).order_by(Tax.name)
    return list((await session.execute(stmt)).scalars())


async def create_tax(session: AsyncSession, payload: TaxCreate) -> Tax:
    existing = (
        await session.execute(select(Tax).where(Tax.name == payload.name))
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("A tax with this name already exists.")

    tax = Tax(name=payload.name, rate=payload.rate)
    session.add(tax)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="tax",
        entity_id=tax.id,
        after={"name": tax.name, "rate": str(tax.rate)},
    )
    return tax


# --- category-level pricing defaults ----------------------------------------


async def _recompute_category_products(
    session: AsyncSession, category_id: int, settings: PricingSettings
) -> None:
    """Every product in the category, override or not, gets a fresh
    ``list_price`` and a history row — cheapest correct option (rule 7
    means the *history* of what a price was must never move, not that
    recomputing the *current* one has to be avoided) over trying to work
    out in advance which ones actually inherit."""
    stmt = (
        select(Product).where(Product.category_id == category_id).options(*_PRODUCT_PRICING_OPTIONS)
    )
    products = list((await session.execute(stmt)).scalars())
    for product in products:
        _recompute_with(product, settings)
        await _record_history(session, product)
    await session.flush()


async def update_category_pricing(
    session: AsyncSession, category_id: int, payload: CategoryPricingUpdate
) -> ProductCategory:
    category = await catalog.get_category(session, category_id)
    before = {
        "margin_rate": str(category.margin_rate) if category.margin_rate is not None else None,
        "tax_ids": sorted(t.id for t in category.taxes),
    }

    touched = False
    if "margin_rate" in payload.model_fields_set:
        category.margin_rate = payload.margin_rate
        touched = True
    if "tax_ids" in payload.model_fields_set:
        category.taxes = await _taxes_by_id(session, payload.tax_ids or [])
        touched = True

    await session.flush()
    await audit.record(
        session,
        action="category_pricing_changed",
        entity_type="product_category",
        entity_id=category_id,
        before=before,
        after={
            "margin_rate": str(category.margin_rate) if category.margin_rate is not None else None,
            "tax_ids": sorted(t.id for t in category.taxes),
        },
    )

    if touched:
        await _recompute_category_products(session, category_id, await get_settings(session))

    return await catalog.get_category(session, category_id)


# --- store-wide pricing settings --------------------------------------------


async def get_settings(session: AsyncSession) -> PricingSettings:
    """Get-or-create the single settings row. Only ever missing on a
    database that predates this migration's seed, in practice (tests spin
    up a fresh, already-migrated database, so this is defensive, not the
    normal path)."""
    settings = (await session.execute(select(PricingSettings))).scalars().first()
    if settings is None:
        # Trivial valid fallback ("cost" alone is always a legal formula —
        # no tax/margin applied) — only reached if the migration's seed row
        # is somehow missing; a real store overwrites this from the panel.
        settings = PricingSettings(formula="cost")
        session.add(settings)
        await session.flush()
    return settings


async def update_settings(session: AsyncSession, payload: PricingSettingsUpdate) -> PricingSettings:
    try:
        formula.validate(payload.formula)
    except FormulaError as exc:
        raise ValidationError(str(exc)) from exc

    settings = await get_settings(session)
    before = {"formula": settings.formula}
    settings.formula = payload.formula
    await session.flush()
    await audit.record(
        session,
        action="pricing_settings_changed",
        entity_type="pricing_settings",
        entity_id=settings.id,
        before=before,
        after={"formula": settings.formula},
    )

    # Every product that relies on the store default (no formula of its
    # own) gets its price recomputed against the new one.
    stmt = select(Product).where(Product.price_formula.is_(None)).options(*_PRODUCT_PRICING_OPTIONS)
    products = list((await session.execute(stmt)).scalars())
    for product in products:
        _recompute_with(product, settings)
        await _record_history(session, product)
    await session.flush()

    return settings
