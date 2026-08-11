"""Sale (cart) management and checkout.

``DRAFT -> CANCELLED`` never touches stock — adding/removing a line only
snapshots prices and computes totals. ``DRAFT -> COMPLETED`` (:func:`checkout`)
is the only place stock availability is ever checked, atomically with
recording the payment(s) and moving the ledger (rule 5): every line is
locked and decremented (FEFO, via ``app.lots.service``, for lot-tracked
products; a plain ``app.inventory.service.record_movement`` otherwise)
*before* the sale flips to ``COMPLETED`` — any failure partway through
rolls back the whole request (phase 0's one-transaction-per-request
policy), so a sale can never end up completed with only some of its lines
actually deducted from stock.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
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
from app.inventory import service as inventory_service
from app.inventory.models import Location, MovementType, Warehouse
from app.lots import service as lots_service
from app.pricing import service as pricing_service
from app.sales.models import Payment, PaymentMethod, Sale, SaleLine, SaleStatus
from app.sales.schemas import (
    CheckoutRequest,
    SaleCreate,
    SaleLineByBarcodeCreate,
    SaleLineCreate,
)
from app.settings import store as settings_store

_SALE_OPTIONS = (
    selectinload(Sale.lines).selectinload(SaleLine.product),
    selectinload(Sale.lines).selectinload(SaleLine.package),
    selectinload(Sale.payments),
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


def compute_amounts(
    quantity_base: Decimal,
    unit_price: Decimal,
    discount_rate: Decimal,
    tax_rate: Decimal,
    *,
    prices_include_tax: bool,
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    """``(subtotal, discount_amount, tax_amount, total)``, quantized — the
    one place that branches on ``PricingSettings.prices_include_tax``
    (app.pricing.models). Shared by ``compute_line_totals`` below (a whole
    ``SaleLine``) and ``app.returns.service`` (an arbitrary partial
    quantity of one), so "IVA incluido en el precio" behaves identically
    everywhere a line's money is computed from its snapshotted rates —
    not just cosmetically on the ticket.

    ``prices_include_tax=False`` (the historical default): ``unit_price``
    is net of tax, so tax is *added* on top after the discount.
    ``prices_include_tax=True``: ``unit_price`` already is the final price
    the customer pays, so tax is *extracted* from it instead — ``total``
    is the same "what was charged" figure either way, only how much of it
    counts as ``tax_amount`` vs. net changes.
    """
    subtotal = quantity_base * unit_price
    discount_amount = subtotal * discount_rate / Decimal(100)
    remaining = subtotal - discount_amount
    if prices_include_tax:
        net = remaining / (Decimal(1) + tax_rate / Decimal(100))
        tax_amount = remaining - net
        total = remaining
    else:
        tax_amount = remaining * tax_rate / Decimal(100)
        total = remaining + tax_amount
    return _q(subtotal), _q(discount_amount), _q(tax_amount), _q(total)


def compute_line_totals(line: SaleLine, *, prices_include_tax: bool) -> LineTotals:
    """Deterministic from the line's own snapshots — never stored, so there
    is nothing that could drift out of sync with them."""
    subtotal, discount_amount, tax_amount, total = compute_amounts(
        line.quantity_base,
        line.unit_price,
        line.discount_rate,
        line.tax_rate,
        prices_include_tax=prices_include_tax,
    )
    return LineTotals(
        subtotal=subtotal, discount_amount=discount_amount, tax_amount=tax_amount, total=total
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
    session: AsyncSession,
    *,
    status: str | None = None,
    warehouse_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Sale]:
    stmt = (
        select(Sale)
        .options(*_SALE_OPTIONS)
        .order_by(Sale.created_at.desc(), Sale.id.desc())
        .limit(limit)
        .offset(offset)
    )
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
    tax_rate: Decimal,
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
        # copied now — never re-read from the product again. ``tax_rate``
        # is the *effective* rate resolved by
        # `app.pricing.service.effective_tax_rate` (the product's own
        # taxes, else its category's, else the legacy scalar column), not
        # `Product.tax_rate` on its own: nothing keeps that column in sync
        # with the `Tax` entities, so a product priced from the admin
        # panel carries 0 there and its line would land on the receipt
        # with no tax to report at all.
        unit_price=product.list_price,
        tax_rate=tax_rate,
        discount_rate=discount_rate,
    )


def _add_or_merge(sale: Sale, line: SaleLine, session: AsyncSession) -> SaleLine:
    """Pasar tres veces el mismo producto es una línea de tres, no tres
    líneas de uno: es como lo espera quien lee el ticket, y como lo cuenta
    quien repasa la compra en el carrito. Suma las cantidades sobre la línea
    que ya había y devuelve la línea resultante.

    Sólo se juntan si coinciden en todo lo que decide el importe —producto,
    formato, precio unitario, descuento e impuesto—. Si algo difiere se
    quedan aparte: si el PVP ha cambiado a mitad de venta, o una lleva
    descuento y la otra no, juntarlas cambiaría lo que se cobra o escondería
    el descuento.

    Sin riesgo con las devoluciones: sólo se añaden líneas a una venta en
    borrador, y una venta en borrador todavía no puede tener nada devuelto.
    """
    for existing in sale.lines:
        if (
            existing.product_id == line.product_id
            and existing.package_id == line.package_id
            and existing.unit_price == line.unit_price
            and existing.discount_rate == line.discount_rate
            and existing.tax_rate == line.tax_rate
        ):
            existing.quantity_packages += line.quantity_packages
            existing.quantity_base += line.quantity_base
            return existing

    session.add(line)
    return line


async def _assert_discount_allowed(session: AsyncSession, discount_rate: Decimal) -> None:
    """`sales.max_discount_rate` (app.settings.registry) — a ceiling on what
    one line can be discounted by, so a mistyped discount at the till can't
    give the shop away. Enforced here rather than in the schema because the
    limit belongs to the shop, not to the API."""
    maximum = Decimal(str(await settings_store.get_value(session, "sales.max_discount_rate")))
    if discount_rate > maximum:
        raise ValidationError(
            f"El descuento máximo por línea es del {maximum}% (se ha pedido "
            f"{discount_rate}%). Se cambia en Configuración → Ventas."
        )


async def add_line(session: AsyncSession, sale_id: int, payload: SaleLineCreate) -> Sale:
    sale = await get_sale(session, sale_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError("Lines can only be added to a draft sale.")
    product = await _sellable_product_or_422(session, payload.product_id)
    package = await _package_or_422(session, payload.product_id, payload.package_id)
    await _assert_discount_allowed(session, payload.discount_rate)

    line = _add_or_merge(
        sale,
        _new_line(
            sale_id=sale_id,
            product=product,
            package=package,
            quantity_packages=payload.quantity_packages,
            discount_rate=payload.discount_rate,
            tax_rate=await pricing_service.effective_tax_rate_for(session, product.id),
        ),
        session,
    )
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
            "line_quantity_packages": str(line.quantity_packages),
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
    await _assert_discount_allowed(session, payload.discount_rate)
    if not product.is_active:
        raise ValidationError(f"Product {product.id} is deactivated and cannot be sold.")

    line = _add_or_merge(
        sale,
        _new_line(
            sale_id=sale_id,
            product=product,
            package=package,
            quantity_packages=payload.quantity_packages,
            discount_rate=payload.discount_rate,
            tax_rate=await pricing_service.effective_tax_rate_for(session, product.id),
        ),
        session,
    )
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
            "line_quantity_packages": str(line.quantity_packages),
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


async def checkout(session: AsyncSession, sale_id: int, payload: CheckoutRequest) -> Sale:
    sale = await get_sale(session, sale_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError(f"Cannot check out a sale that is already {sale.status}.")
    if not sale.lines:
        raise ValidationError("Cannot check out a sale with no lines.")

    prices_include_tax = (await pricing_service.get_settings(session)).prices_include_tax
    sale_total = _q(
        sum(
            (
                compute_line_totals(line, prices_include_tax=prices_include_tax).total
                for line in sale.lines
            ),
            start=Decimal(0),
        )
    )
    tendered_total = _q(sum((p.amount for p in payload.payments), start=Decimal(0)))
    if tendered_total < sale_total:
        raise ValidationError(
            f"Payment does not cover the sale total: needs {sale_total}, got {tendered_total}."
        )

    change_due = tendered_total - sale_total
    if change_due > 0:
        cash_tendered = _q(
            sum(
                (p.amount for p in payload.payments if p.method == PaymentMethod.CASH),
                start=Decimal(0),
            )
        )
        if cash_tendered < change_due:
            raise ValidationError(
                "Change can only be given back on a cash tender — card/other payments must be "
                "exact (no overpayment without a cash tender to cover the change)."
            )

    # `sales.allow_negative_stock` (app.settings.registry): a shop whose
    # inventory is not always up to date would rather sell and reconcile
    # afterwards than have the till refuse a customer. Off by default —
    # the ledger stays the source of truth either way, the balance simply
    # goes negative and says so.
    allow_negative_stock = bool(
        await settings_store.get_value(session, "sales.allow_negative_stock")
    )

    # Rule 5: lock, check and decrement every line's stock *before* the sale
    # is marked COMPLETED — any ConflictError below rolls back this whole
    # request (nothing partially deducted), and nothing here has mutated
    # the sale itself yet, so a DRAFT sale that fails checkout is exactly
    # as it was, ready to retry (e.g. after a restock).
    for line in sale.lines:
        product = line.product
        available = await inventory_service.lock_and_get_available_quantity(
            session,
            product_id=line.product_id,
            warehouse_id=sale.warehouse_id,
            location_id=sale.location_id,
        )
        if available < line.quantity_base and not allow_negative_stock:
            raise ConflictError(
                f"Not enough stock for {product.sku}: needs {line.quantity_base}, "
                f"only {available} available at this location."
            )

        if product.track_lots:
            await lots_service.execute_fefo_consumption(
                session,
                product_id=line.product_id,
                warehouse_id=sale.warehouse_id,
                location_id=sale.location_id,
                quantity=line.quantity_base,
                movement_type=MovementType.SALE,
                unit_cost=product.cost,
                reference_type="sale",
                reference_id=sale.id,
            )
        else:
            await inventory_service.record_movement(
                session,
                product_id=line.product_id,
                warehouse_id=sale.warehouse_id,
                location_id=sale.location_id,
                quantity=-line.quantity_base,
                movement_type=MovementType.SALE,
                unit_cost=product.cost,
                reference_type="sale",
                reference_id=sale.id,
            )

    for tender in payload.payments:
        session.add(Payment(sale_id=sale.id, method=tender.method, amount=tender.amount))

    before = _sale_snapshot(sale)
    sale.status = SaleStatus.COMPLETED
    sale.completed_at = datetime.now(UTC)
    await session.flush()
    await audit.record(
        session,
        action="completed",
        entity_type="sale",
        entity_id=sale_id,
        before=before,
        after={
            **_sale_snapshot(sale),
            "total": str(sale_total),
            "tendered": str(tendered_total),
            "change_due": str(change_due),
        },
    )
    return await get_sale(session, sale_id)
