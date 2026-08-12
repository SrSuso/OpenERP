"""Pricing: formula evaluation, price changes, and their history.

The exclusive write path for a product's cost/tax/surcharge/margin/price/
formula (see the note on ``app.catalog.schemas.ProductUpdate``) — every
change here writes a :class:`~app.pricing.models.ProductPriceHistory` row
in the same transaction, so the history can never miss one.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog import service as catalog
from app.catalog import taxes as catalog_taxes
from app.catalog.models import Product, ProductCategory
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.types import MONEY_QUANTUM
from app.pricing import formula
from app.pricing.formula import FormulaError
from app.pricing.models import PricingSettings, ProductPriceHistory, Tax
from app.pricing.schemas import (
    CategoryPricingUpdate,
    FormulaPreviewRequest,
    PricingSettingsUpdate,
    SetPricingInputsRequest,
    TaxCreate,
    TaxUpdate,
)


def effective_tax_rate(product: Product) -> Decimal:
    """Re-exportada de `app.catalog.taxes`, que es donde vive: la forma de
    lectura del producto también la necesita, y catalog no puede depender
    de pricing. Se sigue leyendo desde aquí porque es la fórmula de precio
    quien la usa en todas partes."""
    return catalog_taxes.effective_tax_rate(product)


def effective_surcharge_rate(product: Product) -> Decimal:
    """Ver `effective_tax_rate` — el recargo de equivalencia que acompaña
    a esos mismos impuestos."""
    return catalog_taxes.effective_surcharge_rate(product)


async def effective_tax_rate_for(session: AsyncSession, product_id: int) -> Decimal:
    """`effective_tax_rate` for a product this caller hasn't loaded with
    the relationships it needs — `app.sales.service` snapshotting the rate
    onto a new line, in practice. Loads through `_product_or_404` so the
    "what has to be eager-loaded" answer lives in one place."""
    return effective_tax_rate(await _product_or_404(session, product_id))


def effective_margin_rate(product: Product) -> Decimal:
    """``None`` = inherit — see `Product.margin_rate`'s own docstring."""
    if product.margin_rate is not None:
        return product.margin_rate
    if product.category is not None and product.category.margin_rate is not None:
        return product.category.margin_rate
    return Decimal(0)


def effective_margin_amount(product: Product) -> Decimal:
    """El margen en dinero, con la misma herencia que el porcentual:
    producto → categoría → 0 €. Ver `Product.margin_amount`."""
    if product.margin_amount is not None:
        return product.margin_amount
    if product.category is not None and product.category.margin_amount is not None:
        return product.category.margin_amount
    return Decimal(0)


def effective_formula(product: Product, settings: PricingSettings) -> str:
    """Qué fórmula se le aplica de verdad a este producto: la suya, si la
    tiene; si no, la de su categoría; si tampoco, la de la tienda. Es la
    tercera forma de poner precio (además del margen en % y del margen en
    €) y también se hereda, para no tener que repetirla producto a
    producto dentro de una misma familia."""
    if product.price_formula:
        return product.price_formula
    if product.category is not None and product.category.price_formula:
        return product.category.price_formula
    return settings.formula


def _variables(product: Product) -> dict[str, Decimal]:
    return {
        "cost": product.cost,
        "tax_rate": effective_tax_rate(product),
        "surcharge_rate": effective_surcharge_rate(product),
        "margin_rate": effective_margin_rate(product),
    }


def _snapshot(product: Product) -> dict[str, Any]:
    return {
        "cost": str(product.cost),
        "list_price": str(product.list_price),
        "tax_rate": str(product.tax_rate),
        "surcharge_rate": str(product.surcharge_rate),
        "margin_rate": str(product.margin_rate) if product.margin_rate is not None else None,
        "margin_amount": (
            str(product.margin_amount) if product.margin_amount is not None else None
        ),
        "tax_ids": sorted(t.id for t in product.taxes),
        "price_formula": product.price_formula,
    }


def _quantize_price(value: Decimal) -> Decimal:
    """A PVP is money — always settled to 2 decimals, however many the
    formula's arithmetic (percentages, divisions...) produced along the
    way. Same rounding unit/mode as ticket rendering
    (``app.tickets.render``), just shared here via ``MONEY_QUANTUM``
    instead of a second local constant."""
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def preview(payload: FormulaPreviewRequest) -> Decimal:
    """Validate and evaluate a formula against arbitrary sample inputs —
    never touches the database. Rounded the same way a real save would be,
    so what's shown here is exactly what ends up as ``list_price``."""
    try:
        result = formula.evaluate(
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
    # Igual que en un guardado de verdad: el margen fijo se suma al
    # resultado, no entra en la fórmula (ver `_recompute_with`).
    return _quantize_price(result + payload.margin_amount)


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
            surcharge_rate=effective_surcharge_rate(product),
            margin_rate=effective_margin_rate(product),
            margin_amount=effective_margin_amount(product),
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
    """Evaluates the product's own formula, or the one it inherits (its
    category's, or the store's), against its *effective* inputs — the
    actual "PVP calculado automáticamente" the margin/tax panels trigger.

    El margen en euros se suma **después**, fuera de la fórmula: así vale
    con cualquiera, incluida una escrita a mano que no lo nombre. Cuando
    era una variable más, poner 25 céntimos en una categoría no hacía nada
    salvo que la fórmula los mencionara — ver `app.pricing.formula`.

    Result is always rounded to 2 decimals — see `_quantize_price`."""
    text = effective_formula(product, settings)
    try:
        result = formula.evaluate(text, _variables(product))
    except FormulaError as exc:
        raise ValidationError(str(exc)) from exc
    product.list_price = _quantize_price(result + effective_margin_amount(product))


async def set_pricing_inputs(
    session: AsyncSession, product_id: int, payload: SetPricingInputsRequest
) -> Product:
    """Update cost/tax/surcharge/margin/taxes — y recalcular el PVP.

    Cualquiera de esos campos es un ingrediente del precio, así que tocar
    cualquiera lo recalcula, con la fórmula del producto o con la que
    hereda (la de su categoría, o la de la tienda). Antes un producto con
    precio puesto a mano lo conservaba aunque le cambiara el coste; ver
    `SetPricingInputsRequest` para por qué ya no.
    """
    product = await _product_or_404(session, product_id)
    before = _snapshot(product)
    touched = False

    if payload.cost is not None:
        product.cost = payload.cost
        touched = True
    if payload.tax_rate is not None:
        product.tax_rate = payload.tax_rate
        touched = True
    if payload.surcharge_rate is not None:
        product.surcharge_rate = payload.surcharge_rate
        touched = True
    if "margin_rate" in payload.model_fields_set:
        product.margin_rate = payload.margin_rate
        touched = True
    if "margin_amount" in payload.model_fields_set:
        product.margin_amount = payload.margin_amount
        touched = True
    if "tax_ids" in payload.model_fields_set:
        product.taxes = await _taxes_by_id(session, payload.tax_ids or [])
        touched = True

    if touched:
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
        result = formula.evaluate(formula_text, _variables(product))
    except FormulaError as exc:
        raise ValidationError(str(exc)) from exc
    product.list_price = _quantize_price(result)

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

    tax = Tax(name=payload.name, rate=payload.rate, surcharge_rate=payload.surcharge_rate)
    session.add(tax)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="tax",
        entity_id=tax.id,
        after={"name": tax.name, "rate": str(tax.rate), "surcharge": str(tax.surcharge_rate)},
    )
    # Ver el mismo `session.refresh` en update_tax: sin esto, `tax.rate`
    # trae el Decimal crudo del JSON en vez del NUMERIC(18,6) normalizado.
    await session.refresh(tax)
    return tax


async def _recompute_every_product(session: AsyncSession) -> None:
    """Anything that changes what a tax *means* can move the price of any
    product that uses it — propio o heredado de su categoría — así que se
    recalcula la lista entera en vez de averiguar cuáles exactamente lo
    usan (más simple, y tan correcto como el recálculo al cambiar la
    fórmula de la tienda)."""
    settings = await get_settings(session)
    stmt = select(Product).options(*_PRODUCT_PRICING_OPTIONS)
    for product in list((await session.execute(stmt)).scalars()):
        _recompute_with(product, settings)
        await _record_history(session, product)
    await session.flush()


async def _set_tax_active(session: AsyncSession, tax_id: int, *, is_active: bool) -> Tax:
    """Rule 14, igual que productos y categorías de TPV: un impuesto no se
    borra nunca, se desactiva — las ventas y el histórico de precios que ya
    lo aplicaron tienen que seguir siendo legibles.

    Desactivarlo lo saca del cálculo (`effective_tax_rate` sólo suma los
    activos), así que recalcula precios exactamente igual que un cambio de
    tasa: un producto al 21% que se queda sin ese impuesto baja de precio
    en el momento, no la próxima vez que alguien lo toque."""
    tax = await session.get(Tax, tax_id)
    if tax is None:
        raise NotFoundError(f"Tax {tax_id} not found.")
    if tax.is_active == is_active:
        return tax

    tax.is_active = is_active
    await session.flush()
    await audit.record(
        session,
        action="activated" if is_active else "deactivated",
        entity_type="tax",
        entity_id=tax_id,
        before={"is_active": not is_active},
        after={"is_active": is_active},
    )
    await _recompute_every_product(session)
    await session.refresh(tax)
    return tax


async def deactivate_tax(session: AsyncSession, tax_id: int) -> Tax:
    return await _set_tax_active(session, tax_id, is_active=False)


async def activate_tax(session: AsyncSession, tax_id: int) -> Tax:
    return await _set_tax_active(session, tax_id, is_active=True)


async def update_tax(session: AsyncSession, tax_id: int, payload: TaxUpdate) -> Tax:
    """Editar nombre y/o tasa de un impuesto ya creado. Un cambio de tasa
    puede afectar a cualquier producto que lo tenga aplicado — propio o
    heredado de su categoría — así que recalcula, sola, la lista entera en
    vez de averiguar cuáles exactamente lo usan (más simple, y tan
    correcto como el recálculo al cambiar la fórmula de la tienda)."""
    tax = await session.get(Tax, tax_id)
    if tax is None:
        raise NotFoundError(f"Tax {tax_id} not found.")
    before = {"name": tax.name, "rate": str(tax.rate), "surcharge": str(tax.surcharge_rate)}

    if payload.name is not None and payload.name != tax.name:
        existing = (
            await session.execute(select(Tax).where(Tax.name == payload.name, Tax.id != tax_id))
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError("A tax with this name already exists.")
        tax.name = payload.name

    rate_changed = payload.rate is not None and payload.rate != tax.rate
    if payload.rate is not None:
        tax.rate = payload.rate
    # El recargo también entra en el precio (por la fórmula), así que
    # cambiarlo tiene que recalcular igual que cambiar la tasa.
    if payload.surcharge_rate is not None and payload.surcharge_rate != tax.surcharge_rate:
        tax.surcharge_rate = payload.surcharge_rate
        rate_changed = True

    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type="tax",
        entity_id=tax_id,
        before=before,
        after={"name": tax.name, "rate": str(tax.rate), "surcharge": str(tax.surcharge_rate)},
    )

    if rate_changed:
        await _recompute_every_product(session)

    # Sin esto, `tax.rate` se queda con el Decimal crudo tal y como llegó
    # en el JSON en vez del valor NUMERIC(18,6) normalizado que Postgres
    # guardó de verdad — mismo motivo que `populate_existing=True` en
    # app.catalog.service.get_product.
    await session.refresh(tax)
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


def _category_state(category: ProductCategory) -> tuple[Any, ...]:
    """Lo mismo que `_category_snapshot`, pero con los números como
    `Decimal` en vez de como texto — para *comparar*.

    Con texto no vale: lo que llega en el JSON es `Decimal("20")` y lo que
    hay guardado es `Decimal("20.000000")`, misma cantidad y distinta
    cadena, así que guardar sin cambiar nada parecía un cambio."""
    return (
        category.margin_rate,
        category.margin_amount,
        category.price_formula,
        tuple(sorted(t.id for t in category.taxes)),
    )


def _category_snapshot(category: ProductCategory) -> dict[str, Any]:
    return {
        "margin_rate": str(category.margin_rate) if category.margin_rate is not None else None,
        "margin_amount": (
            str(category.margin_amount) if category.margin_amount is not None else None
        ),
        "price_formula": category.price_formula,
        "tax_ids": sorted(t.id for t in category.taxes),
    }


async def update_category_pricing(
    session: AsyncSession, category_id: int, payload: CategoryPricingUpdate
) -> ProductCategory:
    category = await catalog.get_category(session, category_id)
    before = _category_snapshot(category)
    state_before = _category_state(category)

    if "margin_rate" in payload.model_fields_set:
        category.margin_rate = payload.margin_rate
    if "margin_amount" in payload.model_fields_set:
        category.margin_amount = payload.margin_amount
    if "price_formula" in payload.model_fields_set:
        # Se valida aquí y no al evaluarla: si está mal, el error tiene que
        # salir al guardarla, no días después al recalcular un producto.
        if payload.price_formula:
            try:
                formula.validate(payload.price_formula)
            except FormulaError as exc:
                raise ValidationError(str(exc)) from exc
        category.price_formula = payload.price_formula or None
    if "tax_ids" in payload.model_fields_set:
        category.taxes = await _taxes_by_id(session, payload.tax_ids or [])

    await session.flush()

    # Sólo si algo ha quedado *distinto*. El panel manda margen, impuestos y
    # fórmula juntos cada vez que se guarda la categoría, aunque sólo se le
    # haya cambiado el nombre: sin esta comparación, renombrar «Bebidas»
    # recalculaba y dejaba una línea de histórico de precios en cada uno de
    # sus productos. El histórico es para mirar por qué cambió un precio, y
    # así se llenaba de cambios que no lo eran.
    if _category_state(category) != state_before:
        await audit.record(
            session,
            action="category_pricing_changed",
            entity_type="product_category",
            entity_id=category_id,
            before=before,
            after=_category_snapshot(category),
        )
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
    before = {"formula": settings.formula, "prices_include_tax": settings.prices_include_tax}
    settings.formula = payload.formula
    settings.prices_include_tax = payload.prices_include_tax
    await session.flush()
    await audit.record(
        session,
        action="pricing_settings_changed",
        entity_type="pricing_settings",
        entity_id=settings.id,
        before=before,
        after={"formula": settings.formula, "prices_include_tax": settings.prices_include_tax},
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
