"""Sale (cart) management.

Only ``DRAFT -> CANCELLED`` is driven here — see the module docstring in
``app.sales.models`` for why reaching ``COMPLETED`` belongs to phase 13.
Nothing in this module touches ``stock_movements``/``stock_balance``:
adding a line only ever snapshots prices and computes totals, it never
reserves or moves stock — phase 13's checkout is the only place stock
availability is ever checked, atomically with recording the payment.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog import service as catalog_service
from app.catalog.models import Product, ProductPackage
from app.core.context import get_user_id
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.types import NUMERIC_EPSILON
from app.inventory.models import Location, Warehouse
from app.sales.models import Sale, SaleLine, SaleStatus
from app.sales.schemas import SaleCreate, SaleLineByBarcodeCreate, SaleLineCreate

_SALE_OPTIONS = (
    selectinload(Sale.lines).selectinload(SaleLine.product),
    selectinload(Sale.lines).selectinload(SaleLine.package),
)


@dataclass(frozen=True)
class LineTotals:
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total: Decimal


def _q(value: Decimal) -> Decimal:
    """Quantize to the same NUMERIC(18,6) scale every stored money/quantity
    column uses — see ``app.purchasing.service._q`` for why this is needed
    at all (multiplying two 6-decimal Decimals yields up to 12 places)."""
    return value.quantize(NUMERIC_EPSILON)


def compute_line_totals(line: SaleLine) -> LineTotals:
    """Deterministic from the line's own snapshots — never stored, so there
    is nothing that could drift out of sync with them."""
    subtotal = line.quantity_base * line.unit_price
    discount_amount = subtotal * line.discount_rate / Decimal(100)
    net = subtotal - discount_amount
    tax_amount = net * line.tax_rate / Decimal(100)
    return LineTotals(
        subtotal=_q(subtotal),
        discount_amount=_q(discount_amount),
        tax_amount=_q(tax_amount),
        total=_q(net + tax_amount),
    )


def _sale_snapshot(sale: Sale) -> dict[str, Any]:
    return {
        "warehouse_id": sale.warehouse_id,
        "location_id": sale.location_id,
        "status": sale.status,
        "notes": sale.notes,
    }


async def get_sale(session: AsyncSession, sale_id: int) -> Sale:
    stmt = (
        select(Sale)
        .where(Sale.id == sale_id)
        .options(*_SALE_OPTIONS)
        .execution_options(populate_existing=True)
    )
    sale = (await session.execute(stmt)).scalar_one_or_none()
    if sale is None:
        raise NotFoundError(f"Sale {sale_id} not found.")
    return sale


async def list_sales(
    session: AsyncSession, *, status: str | None = None, warehouse_id: int | None = None
) -> list[Sale]:
    stmt = select(Sale).options(*_SALE_OPTIONS).order_by(Sale.created_at.desc())
    if status is not None:
        stmt = stmt.where(Sale.status == status)
    if warehouse_id is not None:
        stmt = stmt.where(Sale.warehouse_id == warehouse_id)
    return list((await session.execute(stmt)).scalars())


async def _location_or_422(session: AsyncSession, warehouse_id: int, location_id: int) -> Location:
    if await session.get(Warehouse, warehouse_id) is None:
        raise ValidationError(f"Warehouse {warehouse_id} does not exist.")
    location = await session.get(Location, location_id)
    if location is None or location.warehouse_id != warehouse_id:
        raise ValidationError(
            f"Location {location_id} does not belong to warehouse {warehouse_id}."
        )
    return location


async def create_sale(session: AsyncSession, payload: SaleCreate) -> Sale:
    await _location_or_422(session, payload.warehouse_id, payload.location_id)

    sale = Sale(
        warehouse_id=payload.warehouse_id,
        location_id=payload.location_id,
        notes=payload.notes,
        cashier_user_id=get_user_id(),
    )
    session.add(sale)
    await session.flush()
    await audit.record(
        session, action="created", entity_type="sale", entity_id=sale.id, after=_sale_snapshot(sale)
    )
    return await get_sale(session, sale.id)


async def _package_or_422(
    session: AsyncSession, product_id: int, package_id: int
) -> ProductPackage:
    package = await session.get(ProductPackage, package_id)
    if package is None or package.product_id != product_id:
        raise ValidationError(f"Package {package_id} does not belong to product {product_id}.")
    return package


async def _sellable_product_or_422(session: AsyncSession, product_id: int) -> Product:
    product = await session.get(Product, product_id)
    if product is None:
        raise ValidationError(f"Product {product_id} does not exist.")
    if not product.is_active:
        raise ValidationError(f"Product {product_id} is deactivated and cannot be sold.")
    return product


def _new_line(
    *,
    sale_id: int,
    product: Product,
    package: ProductPackage,
    quantity_packages: Decimal,
    discount_rate: Decimal,
) -> SaleLine:
    return SaleLine(
        sale_id=sale_id,
        product_id=product.id,
        package_id=package.id,
        package_name=package.name,
        package_factor=package.factor,
        quantity_packages=quantity_packages,
        quantity_base=quantity_packages * package.factor,
        # Price snapshot (rule 7): the product's current list price/tax,
        # copied now — never re-read from the product again.
        unit_price=product.list_price,
        tax_rate=product.tax_rate,
        discount_rate=discount_rate,
    )


async def add_line(session: AsyncSession, sale_id: int, payload: SaleLineCreate) -> Sale:
    sale = await get_sale(session, sale_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError("Lines can only be added to a draft sale.")
    product = await _sellable_product_or_422(session, payload.product_id)
    package = await _package_or_422(session, payload.product_id, payload.package_id)

    line = _new_line(
        sale_id=sale_id,
        product=product,
        package=package,
        quantity_packages=payload.quantity_packages,
        discount_rate=payload.discount_rate,
    )
    session.add(line)
    await session.flush()
    await audit.record(
        session,
        action="line_added",
        entity_type="sale",
        entity_id=sale_id,
        after={
            "product_id": payload.product_id,
            "package": package.name,
            "quantity_packages": str(payload.quantity_packages),
        },
    )
    return await get_sale(session, sale_id)


async def add_line_by_barcode(
    session: AsyncSession, sale_id: int, payload: SaleLineByBarcodeCreate
) -> Sale:
    sale = await get_sale(session, sale_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError("Lines can only be added to a draft sale.")

    product, package = await catalog_service.get_product_by_barcode(session, payload.barcode)
    if not product.is_active:
        raise ValidationError(f"Product {product.id} is deactivated and cannot be sold.")

    line = _new_line(
        sale_id=sale_id,
        product=product,
        package=package,
        quantity_packages=payload.quantity_packages,
        discount_rate=payload.discount_rate,
    )
    session.add(line)
    await session.flush()
    await audit.record(
        session,
        action="line_added",
        entity_type="sale",
        entity_id=sale_id,
        after={
            "product_id": product.id,
            "package": package.name,
            "quantity_packages": str(payload.quantity_packages),
            "barcode": payload.barcode,
        },
    )
    return await get_sale(session, sale_id)


async def remove_line(session: AsyncSession, sale_id: int, line_id: int) -> Sale:
    sale = await get_sale(session, sale_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError("Lines can only be removed from a draft sale.")
    line = next((candidate for candidate in sale.lines if candidate.id == line_id), None)
    if line is None:
        raise NotFoundError(f"Line {line_id} not found on sale {sale_id}.")

    await session.delete(line)
    await session.flush()
    await audit.record(
        session,
        action="line_removed",
        entity_type="sale",
        entity_id=sale_id,
        before={"line_id": line_id},
    )
    return await get_sale(session, sale_id)


async def cancel_sale(session: AsyncSession, sale_id: int) -> Sale:
    sale = await get_sale(session, sale_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError(f"Cannot cancel a sale that is already {sale.status}.")

    before = _sale_snapshot(sale)
    sale.status = SaleStatus.CANCELLED
    await session.flush()
    await audit.record(
        session,
        action="cancelled",
        entity_type="sale",
        entity_id=sale_id,
        before=before,
        after=_sale_snapshot(sale),
    )
    return await get_sale(session, sale_id)
