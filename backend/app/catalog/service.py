"""Product catalog management."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog.models import (
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
        selectinload(Product.category),
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
    return {
        "sku": product.sku,
        "name": product.name,
        "category_id": product.category_id,
        "pos_category_id": product.pos_category_id,
        "pos_display_order": product.pos_display_order,
        "base_unit_name": product.base_unit_name,
        "cost": str(product.cost),
        "list_price": str(product.list_price),
        "tax_rate": str(product.tax_rate),
        "surcharge_rate": str(product.surcharge_rate),
        "margin_rate": str(product.margin_rate) if product.margin_rate is not None else None,
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


async def create_category(session: AsyncSession, payload: ProductCategoryCreate) -> ProductCategory:
    existing = (
        await session.execute(select(ProductCategory).where(ProductCategory.name == payload.name))
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("A category with this name already exists.")

    category = ProductCategory(name=payload.name)
    session.add(category)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="product_category",
        entity_id=category.id,
        after={"name": category.name},
    )
    return await get_category(session, category.id)


async def update_category(
    session: AsyncSession, category_id: int, payload: ProductCategoryUpdate
) -> ProductCategory:
    """Renombrar una categoría ya creada (una errata, un nombre que ya no
    dice lo que vende). Se renombra en el sitio, con el mismo id: los
    productos que la tienen asignada siguen apuntando a ella."""
    category = await get_category(session, category_id)
    if category.name == payload.name:
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

    before = category.name
    category.name = payload.name
    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type="product_category",
        entity_id=category_id,
        before={"name": before},
        after={"name": category.name},
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
        name=payload.name, color=payload.color, display_order=payload.display_order
    )
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


async def deactivate_pos_category(session: AsyncSession, pos_category_id: int) -> PosCategory:
    """Rule 14: POS categories are never deleted, only deactivated. Products
    already assigned to it keep the link (traceability) — the POS grid
    (phase 12) is expected to only offer active categories, so a
    deactivated one simply stops being selectable, not silently reassigned."""
    category = await get_pos_category(session, pos_category_id)
    before = _pos_category_snapshot(category)
    category.is_active = False
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
) -> list[Product]:
    stmt = select(Product).options(*_product_options()).order_by(Product.name)
    if active_only:
        stmt = stmt.where(Product.is_active.is_(True))
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    if pos_category_id is not None:
        stmt = stmt.where(Product.pos_category_id == pos_category_id)
        stmt = stmt.order_by(None).order_by(Product.pos_display_order, Product.name)
    if search:
        pattern = f"%{search.lower()}%"
        # También por código de barras: es lo que está impreso en el
        # producto y lo que teclea (o escanea) quien lo tiene en la mano,
        # mientras que el SKU es una referencia interna. Como EXISTS y no
        # como join, para que un producto con varios códigos que encajen
        # siga saliendo una sola vez.
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
                func.lower(Product.sku).like(pattern),
                by_barcode,
            )
        )
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
        base_unit_name=payload.base_unit_name,
        cost=payload.cost,
        list_price=payload.list_price,
        tax_rate=payload.tax_rate,
        surcharge_rate=payload.surcharge_rate,
        margin_rate=payload.margin_rate,
        min_stock=payload.min_stock
        if "min_stock" in payload.model_fields_set
        else Decimal(str(shop["catalog.default_min_stock"])),
        track_lots=payload.track_lots,
        track_expiration=payload.track_expiration,
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
    if payload.min_stock is not None:
        product.min_stock = payload.min_stock
    if payload.track_lots is not None:
        product.track_lots = payload.track_lots
    if payload.track_expiration is not None:
        product.track_expiration = payload.track_expiration

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
    """Rule 14: products are never deleted, only deactivated."""
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


async def activate_product(session: AsyncSession, product_id: int) -> Product:
    """The other half of rule 14's "deactivated, never deleted": a product
    stopped selling by mistake, or one that comes back into the catalogue,
    can be switched active again — it never lost its id/SKU/history while
    inactive, so this is just flipping the flag back."""
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
        product_id=product_id, name=payload.name, factor=payload.factor, is_base=False
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
        after={"package": payload.name, "factor": str(payload.factor)},
    )
    return updated


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
