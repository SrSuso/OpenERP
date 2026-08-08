"""Product catalog management."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog.models import PosCategory, Product, ProductBarcode, ProductCategory, ProductPackage
from app.catalog.schemas import (
    BarcodeCreate,
    PackageCreate,
    PosCategoryCreate,
    PosCategoryUpdate,
    ProductCategoryCreate,
    ProductCreate,
    ProductUpdate,
)
from app.core.errors import ConflictError, NotFoundError, ValidationError

_PRODUCT_OPTIONS = (
    selectinload(Product.category),
    selectinload(Product.pos_category),
    selectinload(Product.packages).selectinload(ProductPackage.barcodes),
)


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
        "margin_rate": str(product.margin_rate),
        "price_formula": product.price_formula,
        "min_stock": str(product.min_stock),
        "track_lots": product.track_lots,
        "track_expiration": product.track_expiration,
        "is_active": product.is_active,
    }


# --- categories --------------------------------------------------------------


async def list_categories(session: AsyncSession) -> list[ProductCategory]:
    stmt = select(ProductCategory).order_by(ProductCategory.name)
    return list((await session.execute(stmt)).scalars())


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
    return category


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
    stmt = select(Product).options(*_PRODUCT_OPTIONS).order_by(Product.name)
    if active_only:
        stmt = stmt.where(Product.is_active.is_(True))
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    if pos_category_id is not None:
        stmt = stmt.where(Product.pos_category_id == pos_category_id)
        stmt = stmt.order_by(None).order_by(Product.pos_display_order, Product.name)
    if search:
        pattern = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(func.lower(Product.name).like(pattern), func.lower(Product.sku).like(pattern))
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
        .options(*_PRODUCT_OPTIONS)
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

    product = Product(
        sku=payload.sku,
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
        min_stock=payload.min_stock,
        track_lots=payload.track_lots,
        track_expiration=payload.track_expiration,
    )
    session.add(product)
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
