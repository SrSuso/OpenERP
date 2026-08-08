"""Supplier master data and per-product supplier links."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog.models import Product
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.suppliers.models import ProductSupplier, Supplier
from app.suppliers.schemas import ProductSupplierUpsert, SupplierCreate, SupplierUpdate


def _snapshot(supplier: Supplier) -> dict[str, Any]:
    return {
        "name": supplier.name,
        "tax_id": supplier.tax_id,
        "email": supplier.email,
        "phone": supplier.phone,
        "is_active": supplier.is_active,
    }


async def list_suppliers(session: AsyncSession, *, active_only: bool = True) -> list[Supplier]:
    stmt = select(Supplier).order_by(Supplier.name)
    if active_only:
        stmt = stmt.where(Supplier.is_active.is_(True))
    return list((await session.execute(stmt)).scalars())


async def get_supplier(session: AsyncSession, supplier_id: int) -> Supplier:
    supplier = await session.get(Supplier, supplier_id)
    if supplier is None:
        raise NotFoundError(f"Supplier {supplier_id} not found.")
    return supplier


async def create_supplier(session: AsyncSession, payload: SupplierCreate) -> Supplier:
    supplier = Supplier(
        name=payload.name,
        tax_id=payload.tax_id,
        email=payload.email,
        phone=payload.phone,
        address=payload.address,
    )
    session.add(supplier)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="supplier",
        entity_id=supplier.id,
        after=_snapshot(supplier),
    )
    return supplier


async def update_supplier(
    session: AsyncSession, supplier_id: int, payload: SupplierUpdate
) -> Supplier:
    supplier = await get_supplier(session, supplier_id)
    before = _snapshot(supplier)

    if payload.name is not None:
        supplier.name = payload.name
    if payload.tax_id is not None:
        supplier.tax_id = payload.tax_id
    if payload.email is not None:
        supplier.email = payload.email
    if payload.phone is not None:
        supplier.phone = payload.phone
    if payload.address is not None:
        supplier.address = payload.address

    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type="supplier",
        entity_id=supplier_id,
        before=before,
        after=_snapshot(supplier),
    )
    return supplier


async def deactivate_supplier(session: AsyncSession, supplier_id: int) -> Supplier:
    """Rule 14: suppliers are never deleted, only deactivated."""
    supplier = await get_supplier(session, supplier_id)
    before = _snapshot(supplier)
    supplier.is_active = False
    await session.flush()
    await audit.record(
        session,
        action="deactivated",
        entity_type="supplier",
        entity_id=supplier_id,
        before=before,
        after=_snapshot(supplier),
    )
    return supplier


# --- product <-> supplier links ----------------------------------------------

_LINK_OPTIONS = (selectinload(ProductSupplier.product), selectinload(ProductSupplier.supplier))


async def _product_or_422(session: AsyncSession, product_id: int) -> Product:
    product = await session.get(Product, product_id)
    if product is None:
        raise ValidationError(f"Product {product_id} does not exist.")
    return product


async def list_product_suppliers(session: AsyncSession, product_id: int) -> list[ProductSupplier]:
    stmt = (
        select(ProductSupplier)
        .where(ProductSupplier.product_id == product_id)
        .options(*_LINK_OPTIONS)
        .order_by(ProductSupplier.is_preferred.desc(), ProductSupplier.supplier_cost)
    )
    return list((await session.execute(stmt)).scalars())


async def list_supplier_products(session: AsyncSession, supplier_id: int) -> list[ProductSupplier]:
    await get_supplier(session, supplier_id)
    stmt = (
        select(ProductSupplier)
        .where(ProductSupplier.supplier_id == supplier_id)
        .options(*_LINK_OPTIONS)
        .order_by(ProductSupplier.product_id)
    )
    return list((await session.execute(stmt)).scalars())


async def upsert_product_supplier(
    session: AsyncSession, product_id: int, supplier_id: int, payload: ProductSupplierUpsert
) -> ProductSupplier:
    await _product_or_422(session, product_id)
    await get_supplier(session, supplier_id)

    existing = (
        await session.execute(
            select(ProductSupplier)
            .where(
                ProductSupplier.product_id == product_id,
                ProductSupplier.supplier_id == supplier_id,
            )
            .options(*_LINK_OPTIONS)
        )
    ).scalar_one_or_none()

    action = "updated"
    if existing is None:
        existing = ProductSupplier(product_id=product_id, supplier_id=supplier_id)
        session.add(existing)
        action = "created"

    existing.supplier_sku = payload.supplier_sku
    existing.supplier_cost = payload.supplier_cost
    existing.is_preferred = payload.is_preferred
    await session.flush()
    link_id = existing.id

    # populate_existing: without it, `existing.supplier_cost` above stays the
    # exact Decimal we just assigned instead of the NUMERIC(18,6)-normalised
    # value Postgres stored (same class of bug as app.catalog.service —
    # numerically identical, inconsistent precision within one request).
    existing = (
        await session.execute(
            select(ProductSupplier)
            .where(ProductSupplier.id == link_id)
            .options(*_LINK_OPTIONS)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()

    await audit.record(
        session,
        action=f"product_supplier_{action}",
        entity_type="product",
        entity_id=product_id,
        after={
            "supplier_id": supplier_id,
            "supplier_sku": payload.supplier_sku,
            "supplier_cost": str(payload.supplier_cost),
        },
    )
    return existing


async def remove_product_supplier(session: AsyncSession, product_id: int, supplier_id: int) -> None:
    existing = (
        await session.execute(
            select(ProductSupplier).where(
                ProductSupplier.product_id == product_id,
                ProductSupplier.supplier_id == supplier_id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        raise NotFoundError("No such product/supplier link.")
    if existing.is_preferred:
        raise ConflictError("Cannot remove the preferred supplier link; set another one first.")

    await session.delete(existing)
    await session.flush()
    await audit.record(
        session,
        action="product_supplier_removed",
        entity_type="product",
        entity_id=product_id,
        before={"supplier_id": supplier_id},
    )
