"""Product catalog management."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog.models import (
    EntityImage,
    PosCategory,
    Product,
    ProductBarcode,
    ProductCategory,
    ProductPackage,
    Unit,
)
from app.catalog.schemas import (
    BarcodeCreate,
    BarcodeUpdate,
    PackageCreate,
    PosCategoryCreate,
    PosCategoryUpdate,
    ProductCategoryCreate,
    ProductCategoryUpdate,
    ProductCreate,
    ProductUpdate,
    UnitCreate,
    UnitMoveDirection,
    UnitUpdate,
)
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.settings import store as settings_store


# Built by a function, not a module-level tuple: `Product.taxes`/
# `ProductCategory.taxes` (app.catalog.models) reference `Tax`
# (app.pricing.models) by name only (avoids catalog importing pricing —
# pricing already imports catalog, see that relationship's own docstring),
# so SQLAlchemy can't resolve it until app.pricing.models has actually been
# imported somewhere. Building these tuples at call time instead of import
# time guarantees that already happened (the whole app is done importing
# every router — pricing's included — well before the first real request
# reaches any function that calls this), where building them eagerly at
# `import app.catalog.service` time does not: that import happens from
# `app.api.v1.router` *before* pricing's own line in the same file.
def _product_options() -> tuple[Any, ...]:
    return (
        # La categoría con sus impuestos: la forma de lectura del producto
        # resuelve con ellos su tipo efectivo (app.catalog.taxes).
        selectinload(Product.category).selectinload(ProductCategory.taxes),
        selectinload(Product.pos_category),
        selectinload(Product.packages).selectinload(ProductPackage.barcodes),
        selectinload(Product.taxes),
    )


#: A category's own read shape (app.pricing's PATCH .../pricing endpoint
#: returns one too) always needs its taxes alongside it. Same
#: call-time-not-import-time reasoning as `_product_options`.
def _category_options() -> tuple[Any, ...]:
    return (selectinload(ProductCategory.taxes),)


def _snapshot(product: Product) -> dict[str, Any]:
    base_package = next((package for package in product.packages if package.is_base), None)
    base_barcode = (
        base_package.barcodes[0].barcode if base_package and base_package.barcodes else None
    )
    return {
        "name": product.name,
        "category_id": product.category_id,
        "pos_category_id": product.pos_category_id,
        "pos_display_order": product.pos_display_order,
        "is_open_price": product.is_open_price,
        "base_unit_name": product.base_unit_name,
        "base_barcode": base_barcode,
        "cost": str(product.cost),
        "list_price": str(product.list_price),
        "tax_rate": str(product.tax_rate),
        "surcharge_rate": str(product.surcharge_rate),
        "margin_rate": str(product.margin_rate) if product.margin_rate is not None else None,
        "margin_amount": (
            str(product.margin_amount) if product.margin_amount is not None else None
        ),
        "price_formula": product.price_formula,
        "min_stock": str(product.min_stock),
        "track_lots": product.track_lots,
        "track_expiration": product.track_expiration,
        "is_active": product.is_active,
    }


# --- categories --------------------------------------------------------------


async def list_categories(session: AsyncSession) -> list[ProductCategory]:
    stmt = select(ProductCategory).options(*_category_options()).order_by(ProductCategory.name)
    return list((await session.execute(stmt)).scalars())


async def get_category(session: AsyncSession, category_id: int) -> ProductCategory:
    stmt = (
        select(ProductCategory)
        .where(ProductCategory.id == category_id)
        .options(*_category_options())
        .execution_options(populate_existing=True)
    )
    category = (await session.execute(stmt)).scalar_one_or_none()
    if category is None:
        raise NotFoundError(f"Category {category_id} not found.")
    return category


async def _managed_unit_or_422(session: AsyncSession, name: str | None) -> str | None:
    """A category or corrected product unit must come from the managed picker."""
    if name is None:
        return None
    unit = (await session.execute(select(Unit).where(Unit.name == name))).scalar_one_or_none()
    if unit is None:
        raise ValidationError(f"Unit {name!r} does not exist.")
    return unit.name


async def create_category(session: AsyncSession, payload: ProductCategoryCreate) -> ProductCategory:
    existing = (
        await session.execute(select(ProductCategory).where(ProductCategory.name == payload.name))
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("A category with this name already exists.")

    category = ProductCategory(
        name=payload.name,
        tracks_stock=payload.tracks_stock,
        is_sold_by_weight=payload.is_sold_by_weight,
        default_unit_name=await _managed_unit_or_422(session, payload.default_unit_name),
    )
    session.add(category)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="product_category",
        entity_id=category.id,
        after={
            "name": category.name,
            "tracks_stock": category.tracks_stock,
            "is_sold_by_weight": category.is_sold_by_weight,
            "default_unit_name": category.default_unit_name,
        },
    )
    return await get_category(session, category.id)


async def update_category(
    session: AsyncSession, category_id: int, payload: ProductCategoryUpdate
) -> ProductCategory:
    """Renombrar una categoría ya creada (una errata, un nombre que ya no
    dice lo que vende) y decir si sus productos llevan control de
    existencias. Se renombra en el sitio, con el mismo id: los productos
    que la tienen asignada siguen apuntando a ella."""
    category = await get_category(session, category_id)
    if (
        category.name == payload.name
        and category.tracks_stock == payload.tracks_stock
        and (
            payload.is_sold_by_weight is None
            or category.is_sold_by_weight == payload.is_sold_by_weight
        )
        and (
            "default_unit_name" not in payload.model_fields_set
            or category.default_unit_name == payload.default_unit_name
        )
    ):
        return category

    clash = (
        await session.execute(
            select(ProductCategory).where(
                ProductCategory.name == payload.name, ProductCategory.id != category_id
            )
        )
    ).scalar_one_or_none()
    if clash is not None:
        raise ConflictError("A category with this name already exists.")

    before = {
        "name": category.name,
        "tracks_stock": category.tracks_stock,
        "is_sold_by_weight": category.is_sold_by_weight,
        "default_unit_name": category.default_unit_name,
    }
    category.name = payload.name
    category.tracks_stock = payload.tracks_stock
    if payload.is_sold_by_weight is not None:
        category.is_sold_by_weight = payload.is_sold_by_weight
    if "default_unit_name" in payload.model_fields_set:
        category.default_unit_name = await _managed_unit_or_422(session, payload.default_unit_name)
    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type="product_category",
        entity_id=category_id,
        before=before,
        after={
            "name": category.name,
            "tracks_stock": category.tracks_stock,
            "is_sold_by_weight": category.is_sold_by_weight,
            "default_unit_name": category.default_unit_name,
        },
    )
    return await get_category(session, category_id)


async def set_category_active(
    session: AsyncSession, category_id: int, *, is_active: bool
) -> ProductCategory:
    """Ocultar una categoría (regla 14: no se borra, se desactiva). Los
    productos que ya la tienen asignada la conservan —el histórico tiene
    que seguir siendo legible—, simplemente deja de ofrecerse al clasificar
    productos nuevos. Mismo criterio que `deactivate_pos_category`."""
    category = await get_category(session, category_id)
    if category.is_active == is_active:
        return category

    category.is_active = is_active
    await session.flush()
    await audit.record(
        session,
        action="activated" if is_active else "deactivated",
        entity_type="product_category",
        entity_id=category_id,
        before={"is_active": not is_active},
        after={"is_active": is_active},
    )
    return await get_category(session, category_id)


async def delete_category(session: AsyncSession, category_id: int) -> None:
    """Borrado de verdad, y sólo si no la usa ningún producto: si la usara,
    borrarla dejaría a esos productos apuntando a algo que ya no existe (o
    perdería en silencio su clasificación). En ese caso se rechaza y se
    ofrece ocultarla, que conserva el dato."""
    category = await get_category(session, category_id)
    in_use = (
        await session.execute(
            select(func.count()).select_from(Product).where(Product.category_id == category_id)
        )
    ).scalar_one()
    if in_use:
        raise ConflictError(
            f"No se puede borrar «{category.name}»: la usan {in_use} productos. "
            "Ocúltala en su lugar, o cámbiales la categoría antes."
        )

    await session.delete(category)
    await session.flush()
    await audit.record(
        session,
        action="deleted",
        entity_type="product_category",
        entity_id=category_id,
        before={"name": category.name},
    )


# --- units ---------------------------------------------------------------------


# El usuario pidió que estas tres opciones estén siempre disponibles al dar
# productos de alta. Se pueden ordenar, pero no renombrar ni borrar.
_REQUIRED_UNIT_NAMES = frozenset({"KG", "L", "UDS"})


async def list_units(session: AsyncSession) -> list[Unit]:
    stmt = select(Unit).order_by(Unit.display_order, Unit.name)
    return list((await session.execute(stmt)).scalars())


async def create_unit(session: AsyncSession, payload: UnitCreate) -> Unit:
    existing = (
        await session.execute(select(Unit).where(Unit.name == payload.name))
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("A unit with this name already exists.")

    # Al final de la lista actual, no a display_order=0 — así una unidad
    # nueva no salta por delante de las que el usuario ya ha ordenado.
    count = (await session.execute(select(func.count()).select_from(Unit))).scalar_one()

    unit = Unit(name=payload.name, display_order=count)
    session.add(unit)
    await session.flush()
    await audit.record(
        session, action="created", entity_type="unit", entity_id=unit.id, after={"name": unit.name}
    )
    return unit


async def _unit_or_404(session: AsyncSession, unit_id: int) -> Unit:
    unit = (await session.execute(select(Unit).where(Unit.id == unit_id))).scalar_one_or_none()
    if unit is None:
        raise NotFoundError(f"Unit {unit_id} not found.")
    return unit


async def _assert_unit_is_unused(session: AsyncSession, unit: Unit) -> None:
    """Sólo un nombre sin usar se puede renombrar.

    Los productos guardan la unidad base como texto histórico; renombrarla
    cambiaría el significado de cantidades ya registradas. Borrarla es
    distinto: desaparece del selector, pero no reinterpreta esos datos.
    """
    product_count = (
        await session.execute(
            select(func.count()).select_from(Product).where(Product.base_unit_name == unit.name)
        )
    ).scalar_one()
    category_count = (
        await session.execute(
            select(func.count())
            .select_from(ProductCategory)
            .where(ProductCategory.default_unit_name == unit.name)
        )
    ).scalar_one()
    if product_count or category_count:
        references: list[str] = []
        if product_count:
            references.append(f"{product_count} producto(s)")
        if category_count:
            references.append(f"{category_count} categoría(s)")
        raise ConflictError(
            f"No se puede modificar ni borrar la unidad «{unit.name}»: la usan "
            + " y ".join(references)
            + "."
        )


def _assert_unit_is_custom(unit: Unit) -> None:
    if unit.name in _REQUIRED_UNIT_NAMES:
        raise ConflictError(
            f"La unidad «{unit.name}» es estándar y debe conservarse. "
            "Puedes crear una unidad personalizada distinta."
        )


async def update_unit(session: AsyncSession, unit_id: int, payload: UnitUpdate) -> Unit:
    unit = await _unit_or_404(session, unit_id)
    _assert_unit_is_custom(unit)
    if unit.name == payload.name:
        return unit

    duplicate = (
        await session.execute(select(Unit).where(Unit.name == payload.name, Unit.id != unit_id))
    ).scalar_one_or_none()
    if duplicate is not None:
        raise ConflictError("A unit with this name already exists.")

    await _assert_unit_is_unused(session, unit)
    before = {"name": unit.name}
    unit.name = payload.name
    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type="unit",
        entity_id=unit.id,
        before=before,
        after={"name": unit.name},
    )
    return unit


async def delete_unit(session: AsyncSession, unit_id: int) -> None:
    unit = await _unit_or_404(session, unit_id)
    _assert_unit_is_custom(unit)
    before = {"name": unit.name}

    # Una categoría no debe seguir proponiendo una unidad que ya no existe.
    # Los productos, en cambio, conservan su texto histórico: sus cantidades
    # ya están expresadas en esa unidad y el formulario sabe mostrarla aunque
    # no esté disponible para altas nuevas.
    affected_categories = list(
        (
            await session.execute(
                select(ProductCategory).where(ProductCategory.default_unit_name == unit.name)
            )
        ).scalars()
    )
    for category in affected_categories:
        category_before = {"default_unit_name": category.default_unit_name}
        category.default_unit_name = None
        await audit.record(
            session,
            action="updated",
            entity_type="product_category",
            entity_id=category.id,
            before=category_before,
            after={"default_unit_name": None},
        )

    await session.delete(unit)
    await session.flush()

    # Al quitar una fila, el orden que ve el desplegable sigue siendo
    # compacto y determinista.
    for index, remaining in enumerate(await list_units(session)):
        remaining.display_order = index
    await session.flush()
    await audit.record(
        session,
        action="deleted",
        entity_type="unit",
        entity_id=unit_id,
        before=before,
    )


async def move_unit(
    session: AsyncSession, unit_id: int, direction: UnitMoveDirection
) -> list[Unit]:
    """Sube o baja una unidad un puesto. Renormaliza todo el orden a
    0..N-1 en cada llamada — así los empates de antes del primer
    movimiento (todas en display_order=0 por defecto) nunca bloquean
    reordenar, sin necesitar una migración de datos aparte."""
    units = await list_units(session)
    for index, unit in enumerate(units):
        unit.display_order = index

    try:
        index = next(i for i, u in enumerate(units) if u.id == unit_id)
    except StopIteration:
        raise NotFoundError(f"Unit {unit_id} not found.") from None

    target_index = index - 1 if direction == UnitMoveDirection.up else index + 1
    if 0 <= target_index < len(units):
        units[index].display_order, units[target_index].display_order = (
            units[target_index].display_order,
            units[index].display_order,
        )

    await session.flush()
    return await list_units(session)


# --- POS categories (phase 10) ------------------------------------------------


def _pos_category_snapshot(category: PosCategory) -> dict[str, Any]:
    return {
        "name": category.name,
        "color": category.color,
        "display_order": category.display_order,
        "is_default": category.is_default,
        "is_active": category.is_active,
    }


async def list_pos_categories(
    session: AsyncSession, *, active_only: bool = True
) -> list[PosCategory]:
    stmt = select(PosCategory).order_by(PosCategory.display_order, PosCategory.name)
    if active_only:
        stmt = stmt.where(PosCategory.is_active.is_(True))
    return list((await session.execute(stmt)).scalars())


async def get_pos_category(session: AsyncSession, pos_category_id: int) -> PosCategory:
    stmt = (
        select(PosCategory)
        .where(PosCategory.id == pos_category_id)
        .execution_options(populate_existing=True)
    )
    category = (await session.execute(stmt)).scalar_one_or_none()
    if category is None:
        raise NotFoundError(f"POS category {pos_category_id} not found.")
    return category


async def _assert_pos_category_name_free(
    session: AsyncSession, name: str, *, exclude_id: int | None = None
) -> None:
    stmt = select(PosCategory).where(PosCategory.name == name)
    if exclude_id is not None:
        stmt = stmt.where(PosCategory.id != exclude_id)
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"A POS category named {name!r} already exists.")


async def create_pos_category(session: AsyncSession, payload: PosCategoryCreate) -> PosCategory:
    await _assert_pos_category_name_free(session, payload.name)

    category = PosCategory(
        name=payload.name,
        color=payload.color,
        display_order=payload.display_order,
        is_default=payload.is_default,
    )
    if payload.is_default:
        await session.execute(update(PosCategory).values(is_default=False))
    session.add(category)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="pos_category",
        entity_id=category.id,
        after=_pos_category_snapshot(category),
    )
    return category


async def update_pos_category(
    session: AsyncSession, pos_category_id: int, payload: PosCategoryUpdate
) -> PosCategory:
    category = await get_pos_category(session, pos_category_id)
    before = _pos_category_snapshot(category)

    if payload.name is not None and payload.name != category.name:
        await _assert_pos_category_name_free(session, payload.name, exclude_id=category.id)
        category.name = payload.name
    if payload.color is not None:
        category.color = payload.color
    if payload.display_order is not None:
        category.display_order = payload.display_order
    if payload.is_default is not None:
        if payload.is_default:
            # Una única categoría abre por defecto; al elegir otra, la
            # anterior deja de ser favorita en la misma transacción.
            await session.execute(
                update(PosCategory).where(PosCategory.id != category.id).values(is_default=False)
            )
        category.is_default = payload.is_default

    await session.flush()
    updated = await get_pos_category(session, pos_category_id)
    await audit.record(
        session,
        action="updated",
        entity_type="pos_category",
        entity_id=pos_category_id,
        before=before,
        after=_pos_category_snapshot(updated),
    )
    return updated


async def set_pos_category_active(
    session: AsyncSession, pos_category_id: int, *, is_active: bool
) -> PosCategory:
    """Ocultar o volver a mostrar una categoría del TPV. Reversible: sin el
    camino de vuelta, esconder una por error obligaba a crear otra igual y
    reasignarle los productos a mano."""
    category = await get_pos_category(session, pos_category_id)
    if category.is_active == is_active:
        return category

    before = _pos_category_snapshot(category)
    category.is_active = is_active
    if not is_active:
        category.is_default = False
    await session.flush()
    await audit.record(
        session,
        action="activated" if is_active else "deactivated",
        entity_type="pos_category",
        entity_id=pos_category_id,
        before=before,
        after=_pos_category_snapshot(category),
    )
    return category


async def delete_pos_category(session: AsyncSession, pos_category_id: int) -> None:
    """Borrado de verdad, y sólo si no la usa ningún producto — mismo
    criterio que `delete_category`: borrarla con productos dentro les
    quitaría su sitio en el TPV sin decir nada."""
    category = await get_pos_category(session, pos_category_id)
    in_use = (
        await session.execute(
            select(func.count())
            .select_from(Product)
            .where(Product.pos_category_id == pos_category_id)
        )
    ).scalar_one()
    if in_use:
        raise ConflictError(
            f"No se puede borrar «{category.name}»: la usan {in_use} productos. "
            "Ocúltala en su lugar, o cámbiales la categoría antes."
        )
    await session.delete(category)
    await session.flush()
    await audit.record(
        session,
        action="deleted",
        entity_type="pos_category",
        entity_id=pos_category_id,
        before={"name": category.name},
    )


async def deactivate_pos_category(session: AsyncSession, pos_category_id: int) -> PosCategory:
    """Rule 14: POS categories are never deleted, only deactivated. Products
    already assigned to it keep the link (traceability) — the POS grid
    (phase 12) is expected to only offer active categories, so a
    deactivated one simply stops being selectable, not silently reassigned."""
    category = await get_pos_category(session, pos_category_id)
    before = _pos_category_snapshot(category)
    category.is_active = False
    category.is_default = False
    await session.flush()
    await audit.record(
        session,
        action="deactivated",
        entity_type="pos_category",
        entity_id=pos_category_id,
        before=before,
        after=_pos_category_snapshot(category),
    )
    return category


# --- products ------------------------------------------------------------------


async def list_products(
    session: AsyncSession,
    *,
    category_id: int | None = None,
    pos_category_id: int | None = None,
    active_only: bool = True,
    search: str | None = None,
    limit: int | None = None,
) -> list[Product]:
    stmt = select(Product).options(*_product_options()).order_by(Product.name)
    if active_only:
        stmt = stmt.where(Product.is_active.is_(True))
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    if pos_category_id is not None:
        stmt = stmt.where(Product.pos_category_id == pos_category_id)
        # 1 es el primer botón. El 0 queda reservado para los artículos
        # que no se quieren priorizar y siempre se manda al final.
        zero_last = case((Product.pos_display_order == 0, 1), else_=0)
        stmt = stmt.order_by(None).order_by(zero_last, Product.pos_display_order, Product.name)
    if search:
        pattern = f"%{search.lower()}%"
        # Nombre y descripción se buscan por fragmento, no sólo por palabra
        # completa: ``ta`` encuentra ``Plátano``. También por código de
        # barras: es lo que está impreso en el producto y lo que teclea (o
        # escanea) quien lo tiene en la mano, mientras que el SKU es una
        # referencia interna. Como EXISTS y no como join, un producto con
        # varios códigos que encajen sigue saliendo una sola vez.
        by_barcode = (
            select(ProductBarcode.id)
            .join(ProductPackage, ProductPackage.id == ProductBarcode.package_id)
            .where(
                ProductPackage.product_id == Product.id,
                func.lower(ProductBarcode.barcode).like(pattern),
            )
            .exists()
        )
        stmt = stmt.where(
            or_(
                func.lower(Product.name).like(pattern),
                func.lower(Product.description).like(pattern),
                func.lower(Product.sku).like(pattern),
                by_barcode,
            )
        )
    if limit is not None:
        stmt = stmt.limit(limit)
    return list((await session.execute(stmt)).scalars())


async def get_product(session: AsyncSession, product_id: int) -> Product:
    # populate_existing: this is also how create/update/add_package re-read
    # the product to build their response. Without it, an object already in
    # the session's identity map (e.g. a package just inserted in this same
    # transaction) keeps the exact Decimal it was constructed with instead of
    # the NUMERIC(18,6)-normalised value Postgres actually stored — harmless
    # numerically, but an inconsistent API response within one request.
    stmt = (
        select(Product)
        .where(Product.id == product_id)
        .options(*_product_options())
        .execution_options(populate_existing=True)
    )
    product = (await session.execute(stmt)).scalar_one_or_none()
    if product is None:
        raise NotFoundError(f"Product {product_id} not found.")
    return product


async def get_product_by_barcode(
    session: AsyncSession, barcode: str
) -> tuple[Product, ProductPackage]:
    entry = (
        await session.execute(select(ProductBarcode).where(ProductBarcode.barcode == barcode))
    ).scalar_one_or_none()
    if entry is None:
        raise NotFoundError(f"No product package with barcode {barcode!r}.")

    package = await session.get(ProductPackage, entry.package_id)
    assert package is not None  # FK guarantees this
    product = await get_product(session, package.product_id)
    matched_package = next(p for p in product.packages if p.id == package.id)
    return product, matched_package


async def _category_or_422(session: AsyncSession, category_id: int) -> ProductCategory:
    category = await session.get(ProductCategory, category_id)
    if category is None:
        raise ValidationError(f"Category {category_id} does not exist.")
    return category


async def _pos_category_or_422(session: AsyncSession, pos_category_id: int) -> PosCategory:
    category = await session.get(PosCategory, pos_category_id)
    if category is None:
        raise ValidationError(f"POS category {pos_category_id} does not exist.")
    return category


async def _assert_barcode_free(session: AsyncSession, barcode: str) -> None:
    existing = (
        await session.execute(select(ProductBarcode).where(ProductBarcode.barcode == barcode))
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Barcode {barcode!r} is already assigned to another package.")


async def create_product(session: AsyncSession, payload: ProductCreate) -> Product:
    if payload.sku is not None:
        existing = (
            await session.execute(select(Product).where(Product.sku == payload.sku))
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError("A product with this SKU already exists.")
    if payload.category_id is not None:
        await _category_or_422(session, payload.category_id)
    if payload.pos_category_id is not None:
        await _pos_category_or_422(session, payload.pos_category_id)
    if payload.base_barcode is not None:
        await _assert_barcode_free(session, payload.base_barcode)
    if (
        payload.initial_stock is not None
        and (payload.track_lots or payload.track_expiration)
        and payload.initial_stock.lot_number is None
    ):
        raise ValidationError("Initial stock for a product tracked by lots requires lot_number.")
    if (
        payload.initial_stock is not None
        and payload.track_expiration
        and payload.initial_stock.expiration_date is None
    ):
        raise ValidationError(
            "Initial stock for a product tracked by expiration requires expiration_date."
        )
    # `catalog.sku_prefix`/`catalog.default_min_stock` (app.settings.registry).
    shop = await settings_store.get_values(session)
    sku_prefix = str(shop["catalog.sku_prefix"])

    # No SKU given (the normal case from the admin panel, see ProductCreate's
    # own docstring): insert with a throwaway-unique placeholder, then
    # rewrite it to "P######" from the row's own id once flush has assigned
    # one — a plain string, not a real business key, nothing outside this
    # function ever sees the placeholder.
    product = Product(
        sku=payload.sku if payload.sku is not None else f"__pending_{uuid4().hex[:12]}",
        name=payload.name,
        description=payload.description,
        category_id=payload.category_id,
        pos_category_id=payload.pos_category_id,
        pos_display_order=payload.pos_display_order,
        is_open_price=payload.is_open_price,
        base_unit_name=payload.base_unit_name,
        cost=payload.cost,
        list_price=payload.list_price,
        tax_rate=payload.tax_rate,
        surcharge_rate=payload.surcharge_rate,
        margin_rate=payload.margin_rate,
        margin_amount=payload.margin_amount,
        min_stock=payload.min_stock
        if "min_stock" in payload.model_fields_set
        else Decimal(str(shop["catalog.default_min_stock"])),
        # Caducidad sin lote ni existencias no tiene sentido operativo:
        # no habría a qué fecha asociar las unidades ni qué cantidad por
        # lote controlar. Se fuerza también para llamadas directas a la API.
        track_lots=payload.track_lots or payload.track_expiration,
        track_expiration=payload.track_expiration,
        tracks_stock=True if payload.track_expiration else payload.tracks_stock,
    )
    session.add(product)
    await session.flush()
    if payload.sku is None:
        product.sku = f"{sku_prefix}{product.id:06d}"
        await session.flush()

    # Rule 3/4: every product gets exactly one base package (factor=1),
    # created here rather than exposed as a separate step — a product
    # without one would have nowhere for stock to live.
    base_package = ProductPackage(
        product_id=product.id, name=payload.base_unit_name, factor=Decimal(1), is_base=True
    )
    session.add(base_package)
    await session.flush()
    if payload.base_barcode is not None:
        session.add(ProductBarcode(package_id=base_package.id, barcode=payload.base_barcode))
        await session.flush()

    created = await get_product(session, product.id)
    await audit.record(
        session,
        action="created",
        entity_type="product",
        entity_id=created.id,
        after=_snapshot(created),
    )
    if payload.initial_stock is not None:
        # Keep the opening balance in the immutable ledger, not in a
        # product field.  This runs in the caller's request transaction, so
        # invalid warehouse/location data rolls the product creation back
        # too; there can never be a product that was reported as created
        # with an opening quantity that silently failed to exist.
        from app.inventory import service as inventory_service
        from app.inventory.schemas import AdjustmentCreate
        from app.lots.schemas import LotCreate
        from app.lots.service import get_or_create_lot

        lot_id: int | None = None
        if created.track_lots:
            assert payload.initial_stock.lot_number is not None
            lot = await get_or_create_lot(
                session,
                LotCreate(
                    product_id=created.id,
                    lot_number=payload.initial_stock.lot_number,
                    expiration_date=payload.initial_stock.expiration_date,
                ),
            )
            lot_id = lot.id

        await inventory_service.record_adjustment(
            session,
            AdjustmentCreate(
                product_id=created.id,
                warehouse_id=payload.initial_stock.warehouse_id,
                location_id=payload.initial_stock.location_id,
                movement_type="ADJUSTMENT",
                quantity=payload.initial_stock.quantity,
                unit_cost=created.cost,
                lot_id=lot_id,
                reason="Stock inicial al crear el producto.",
            ),
        )
    return created


async def update_product(session: AsyncSession, product_id: int, payload: ProductUpdate) -> Product:
    product = await get_product(session, product_id)
    before = _snapshot(product)

    if payload.name is not None:
        product.name = payload.name
    if payload.description is not None:
        product.description = payload.description
    if payload.category_id is not None:
        await _category_or_422(session, payload.category_id)
        product.category_id = payload.category_id
    if payload.pos_category_id is not None:
        await _pos_category_or_422(session, payload.pos_category_id)
        product.pos_category_id = payload.pos_category_id
    if payload.pos_display_order is not None:
        product.pos_display_order = payload.pos_display_order
    if payload.is_open_price is not None:
        product.is_open_price = payload.is_open_price
    if "base_barcode" in payload.model_fields_set:
        base_package = next((package for package in product.packages if package.is_base), None)
        if base_package is None:
            raise ConflictError("El producto no tiene un formato base para su código de barras.")
        primary_barcode = base_package.barcodes[0] if base_package.barcodes else None
        if payload.base_barcode is None:
            if primary_barcode is not None:
                await session.delete(primary_barcode)
        elif primary_barcode is None:
            await _assert_barcode_free(session, payload.base_barcode)
            session.add(ProductBarcode(package_id=base_package.id, barcode=payload.base_barcode))
        elif primary_barcode.barcode != payload.base_barcode:
            await _assert_barcode_free(session, payload.base_barcode)
            primary_barcode.barcode = payload.base_barcode
    if payload.base_unit_name is not None and payload.base_unit_name != product.base_unit_name:
        unit_name = await _managed_unit_or_422(session, payload.base_unit_name)
        # The input above is non-null; this keeps the type contract explicit
        # should `_managed_unit_or_422` ever be reused differently.
        if unit_name is None:
            raise ValidationError("A base unit is required.")
        base_package = next((package for package in product.packages if package.is_base), None)
        if base_package is None:
            raise ConflictError("El producto no tiene un formato base que se pueda corregir.")
        product.base_unit_name = unit_name
        base_package.name = unit_name
    if payload.min_stock is not None:
        product.min_stock = payload.min_stock
    if payload.track_expiration is not None:
        product.track_expiration = payload.track_expiration
    if product.track_expiration:
        # La caducidad es trazabilidad por lote y necesita stock. Prima
        # sobre una petición incompatible de apagar ambos controles o de
        # heredar una categoría sin stock.
        product.track_lots = True
        product.tracks_stock = True
    else:
        if payload.track_lots is not None:
            product.track_lots = payload.track_lots
        # Tres estados: volver a heredar de la categoría es una petición
        # explícita, porque "no me lo mandes" ya significa "déjalo como
        # está".
        if payload.inherit_tracks_stock:
            product.tracks_stock = None
        elif payload.tracks_stock is not None:
            product.tracks_stock = payload.tracks_stock

    await session.flush()
    updated = await get_product(session, product_id)
    await audit.record(
        session,
        action="updated",
        entity_type="product",
        entity_id=product_id,
        before=before,
        after=_snapshot(updated),
    )
    return updated


async def deactivate_product(session: AsyncSession, product_id: int) -> Product:
    """Retira un producto de la venta sin borrar su trazabilidad."""
    product = await get_product(session, product_id)
    before = _snapshot(product)
    product.is_active = False
    await session.flush()
    await audit.record(
        session,
        action="deactivated",
        entity_type="product",
        entity_id=product_id,
        before=before,
        after=_snapshot(product),
    )
    return product


async def delete_product(session: AsyncSession, product_id: int) -> None:
    """Borra un alta equivocada que todavía no tiene historia operativa.

    Las ventas, compras y devoluciones son documentos históricos y conservan
    una FK al producto y a su formato. No se pueden borrar sin falsear esos
    documentos. Sí se puede deshacer la configuración manual de existencias
    y lotes de un producto equivocado: los ajustes sin referencia de negocio
    no son actividad comercial por sí solos. Las mermas, transferencias y
    movimientos documentados siguen protegidos.
    """
    product = await get_product(session, product_id)

    # Imports locales: los dominios que forman el historial dependen de
    # catálogo y no queremos invertir esa dependencia al cargar la app.
    from app.inventory.models import MovementType, StockBalance, StockMovement
    from app.lots.models import Lot
    from app.pricing.models import ProductPriceHistory
    from app.purchasing.models import PurchaseOrderLine
    from app.returns.models import ReturnLine
    from app.sales.models import SaleLine
    from app.suppliers.models import ProductSupplier

    history_checks = (
        ("ventas", select(SaleLine.id).where(SaleLine.product_id == product_id)),
        ("compras", select(PurchaseOrderLine.id).where(PurchaseOrderLine.product_id == product_id)),
        ("devoluciones", select(ReturnLine.id).where(ReturnLine.product_id == product_id)),
    )
    used_by = [
        label
        for label, statement in history_checks
        if (await session.execute(statement.limit(1))).scalar_one_or_none() is not None
    ]

    movements = list(
        (
            await session.execute(
                select(StockMovement).where(StockMovement.product_id == product_id)
            )
        ).scalars()
    )
    balances = list(
        (
            await session.execute(select(StockBalance).where(StockBalance.product_id == product_id))
        ).scalars()
    )
    lots = list((await session.execute(select(Lot).where(Lot.product_id == product_id))).scalars())

    # Al dar de alta un producto se pueden hacer varios recuentos para
    # cuadrar su stock o crear lotes antes de usarlo. Son ADJUSTMENT sin una
    # referencia de negocio y se pueden retirar junto al producto si fue un
    # alta equivocada. Una merma, transferencia o movimiento documentado ya
    # es operación real y debe conservarse.
    has_only_catalog_stock_setup = all(
        movement.movement_type == MovementType.ADJUSTMENT
        and movement.reference_type is None
        and movement.reference_id is None
        for movement in movements
    )
    if not has_only_catalog_stock_setup:
        if movements:
            used_by.append("movimientos de stock")
        if balances:
            used_by.append("stock existente")
        if lots:
            used_by.append("lotes")
    if used_by:
        raise ConflictError(
            f"No se puede eliminar «{product.name}» porque tiene {', '.join(used_by)}. "
            "Desactívalo para conservar el histórico."
        )

    before = _snapshot(product)
    # Estas relaciones no son histórico comercial: se eliminan con el alta
    # equivocada. Los formatos y sus códigos son delete-orphan del modelo.
    # Los saldos, ajustes manuales y lotes permitidos arriba sólo pertenecen
    # a la configuración del producto equivocado. Se retiran antes de borrar
    # el producto para respetar las FKs.
    if has_only_catalog_stock_setup:
        await session.execute(delete(StockBalance).where(StockBalance.product_id == product_id))
        await session.execute(delete(StockMovement).where(StockMovement.product_id == product_id))
        await session.execute(delete(Lot).where(Lot.product_id == product_id))
    await session.execute(
        delete(ProductPriceHistory).where(ProductPriceHistory.product_id == product_id)
    )
    await session.execute(delete(ProductSupplier).where(ProductSupplier.product_id == product_id))
    await session.execute(
        delete(EntityImage).where(
            EntityImage.entity_type == "product", EntityImage.entity_id == product_id
        )
    )
    await session.delete(product)
    await session.flush()
    await audit.record(
        session,
        action="deleted",
        entity_type="product",
        entity_id=product_id,
        before=before,
    )


async def activate_product(session: AsyncSession, product_id: int) -> Product:
    """Vuelve a vender un producto desactivado sin tocar su historial."""
    product = await get_product(session, product_id)
    before = _snapshot(product)
    product.is_active = True
    await session.flush()
    await audit.record(
        session,
        action="activated",
        entity_type="product",
        entity_id=product_id,
        before=before,
        after=_snapshot(product),
    )
    return product


async def add_package(session: AsyncSession, product_id: int, payload: PackageCreate) -> Product:
    await get_product(session, product_id)  # 404s if the product doesn't exist
    existing = (
        await session.execute(
            select(ProductPackage).where(
                ProductPackage.product_id == product_id, ProductPackage.name == payload.name
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Product already has a package named {payload.name!r}.")
    if payload.barcode is not None:
        await _assert_barcode_free(session, payload.barcode)

    package = ProductPackage(
        product_id=product_id,
        name=payload.name,
        factor=payload.factor,
        price_override=payload.price_override,
        is_base=False,
    )
    session.add(package)
    await session.flush()
    if payload.barcode is not None:
        session.add(ProductBarcode(package_id=package.id, barcode=payload.barcode))
        await session.flush()

    updated = await get_product(session, product_id)
    await audit.record(
        session,
        action="package_added",
        entity_type="product",
        entity_id=product_id,
        after={
            "package": payload.name,
            "factor": str(payload.factor),
            "price_override": (
                str(payload.price_override) if payload.price_override is not None else None
            ),
        },
    )
    return updated


async def update_package_price(
    session: AsyncSession, product_id: int, package_id: int, price_override: Decimal | None
) -> Product:
    package = await session.get(ProductPackage, package_id)
    if package is None or package.product_id != product_id:
        raise NotFoundError(f"Package {package_id} not found on product {product_id}.")
    if package.is_base:
        raise ValidationError("The base package always uses the product final price.")

    before = package.price_override
    package.price_override = price_override
    await session.flush()
    await audit.record(
        session,
        action="package_price_updated",
        entity_type="product",
        entity_id=product_id,
        before={
            "package_id": package_id,
            "price_override": str(before) if before is not None else None,
        },
        after={
            "package_id": package_id,
            "price_override": str(price_override) if price_override is not None else None,
        },
    )
    return await get_product(session, product_id)


async def add_barcode(
    session: AsyncSession, product_id: int, package_id: int, payload: BarcodeCreate
) -> Product:
    package = await session.get(ProductPackage, package_id)
    if package is None or package.product_id != product_id:
        raise NotFoundError(f"Package {package_id} not found on product {product_id}.")
    await _assert_barcode_free(session, payload.barcode)

    session.add(ProductBarcode(package_id=package_id, barcode=payload.barcode))
    await session.flush()

    updated = await get_product(session, product_id)
    await audit.record(
        session,
        action="barcode_added",
        entity_type="product",
        entity_id=product_id,
        after={"package_id": package_id, "barcode": payload.barcode},
    )
    return updated


async def _get_barcode_or_404(
    session: AsyncSession, product_id: int, package_id: int, barcode_id: int
) -> ProductBarcode:
    package = await session.get(ProductPackage, package_id)
    if package is None or package.product_id != product_id:
        raise NotFoundError(f"Package {package_id} not found on product {product_id}.")
    barcode = await session.get(ProductBarcode, barcode_id)
    if barcode is None or barcode.package_id != package_id:
        raise NotFoundError(f"Barcode {barcode_id} not found on package {package_id}.")
    return barcode


async def update_barcode(
    session: AsyncSession,
    product_id: int,
    package_id: int,
    barcode_id: int,
    payload: BarcodeUpdate,
) -> Product:
    """A barcode typed wrong, or one that changed on the manufacturer's
    label — edited in place rather than "delete and re-add" so it keeps
    the same row (and audit trail) instead of a fresh id."""
    barcode = await _get_barcode_or_404(session, product_id, package_id, barcode_id)
    before = barcode.barcode
    if payload.barcode != before:
        await _assert_barcode_free(session, payload.barcode)
        barcode.barcode = payload.barcode
        await session.flush()

    updated = await get_product(session, product_id)
    await audit.record(
        session,
        action="barcode_updated",
        entity_type="product",
        entity_id=product_id,
        before={"package_id": package_id, "barcode": before},
        after={"package_id": package_id, "barcode": payload.barcode},
    )
    return updated


async def delete_barcode(
    session: AsyncSession, product_id: int, package_id: int, barcode_id: int
) -> Product:
    """One added by mistake, or a discontinued code — removed outright
    (unlike a product/package, a barcode is just an alternate lookup key,
    not something sales/inventory ever reference directly, so there is no
    rule-14-style "deactivate instead" history to preserve here)."""
    barcode = await _get_barcode_or_404(session, product_id, package_id, barcode_id)
    removed = barcode.barcode
    await session.delete(barcode)
    await session.flush()

    updated = await get_product(session, product_id)
    await audit.record(
        session,
        action="barcode_deleted",
        entity_type="product",
        entity_id=product_id,
        before={"package_id": package_id, "barcode": removed},
    )
    return updated
