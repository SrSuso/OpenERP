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

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog import service as catalog_service
from app.catalog import stock as catalog_stock
from app.catalog.models import Product, ProductPackage
from app.core.context import get_user_id
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.types import NUMERIC_EPSILON
from app.idempotency import service as idempotency_service
from app.inventory import service as inventory_service
from app.inventory.models import MovementType
from app.lots import service as lots_service
from app.pos import service as pos_service
from app.pricing import service as pricing_service
from app.sales import accounting
from app.sales.models import Payment, PaymentMethod, Sale, SaleLine, SaleStatus
from app.sales.schemas import (
    CheckoutRequest,
    SaleCreate,
    SaleLineByBarcodeCreate,
    SaleLineCreate,
)
from app.settings import store as settings_store
from app.users.models import User

_SALE_OPTIONS = (
    selectinload(Sale.lines),
    selectinload(Sale.payments),
    selectinload(Sale.terminal),
)

_CHECKOUT_OPERATION = "sale.checkout"


@dataclass(frozen=True)
class LineTotals:
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total: Decimal


#: Lo que de verdad se puede cobrar: euros y céntimos. Los importes se
#: calculan y se guardan con seis decimales (`NUMERIC(18,6)`, regla 8) para
#: que un IVA o un descuento no pierdan precisión por el camino, pero lo
#: que se le pide al cliente y lo que entra en el cajón no baja del
#: céntimo.
CENTS = Decimal("0.01")


def payable(total: Decimal) -> Decimal:
    """El total redondeado a céntimos: lo que se cobra y lo que se imprime.

    Sin esto, una venta de 1,231560 € se enseñaba en el TPV como 1,23 —que
    es lo único que se puede teclear y lo único que se puede dar— y luego
    el cobro la rechazaba por no llegar a 1,23156. No había forma de cobrar
    esa venta.

    Se devuelve en la escala de siempre (seis decimales, con ceros detrás):
    el valor ya es exacto en céntimos, y así todos los importes de la API
    se siguen escribiendo igual.
    """
    return total.quantize(CENTS, rounding=ROUND_HALF_UP).quantize(NUMERIC_EPSILON)


def _q(value: Decimal) -> Decimal:
    """Quantize to the same NUMERIC(18,6) scale every stored money/quantity
    column uses — see ``app.purchasing.service._q`` for why this is needed
    at all (multiplying two 6-decimal Decimals yields up to 12 places)."""
    return value.quantize(NUMERIC_EPSILON)


async def _allows_negative_stock(session: AsyncSession) -> bool:
    return bool(await settings_store.get_value(session, "sales.allow_negative_stock"))


def _insufficient_stock_error(
    *, product_name: str, required: Decimal, available: Decimal
) -> ConflictError:
    return ConflictError(
        f"No hay existencias suficientes de «{product_name}»: se necesitan "
        f"{required} y solo hay {available} disponibles en esta ubicación.",
        details={"reason": "insufficient_stock", "product_name": product_name},
    )


def compute_amounts(
    quantity_base: Decimal,
    unit_price: Decimal,
    discount_rate: Decimal,
    tax_rate: Decimal,
    *,
    cold_drink_surcharge: Decimal = Decimal(0),
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
    product_subtotal = quantity_base * unit_price
    surcharge_total = quantity_base * cold_drink_surcharge
    subtotal = product_subtotal + surcharge_total
    # A cold-drink charge is an explicit service surcharge, not a product
    # discount. A line discount stays attached to the product price only.
    discount_amount = product_subtotal * discount_rate / Decimal(100)
    remaining = product_subtotal - discount_amount + surcharge_total
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
        cold_drink_surcharge=line.cold_drink_surcharge,
        prices_include_tax=prices_include_tax,
    )
    return LineTotals(
        subtotal=subtotal, discount_amount=discount_amount, tax_amount=tax_amount, total=total
    )


def package_price(line: SaleLine) -> Decimal:
    """Catalogue price of one snapshotted package, before line discounts.

    The current catalogue has one price per base unit rather than a price
    override on each package.  Keeping this calculation here makes the API,
    not the browser, authoritative for converting that price to the package
    selected by the barcode.
    """
    return _q(line.unit_price * line.package_factor)


def _sale_snapshot(sale: Sale) -> dict[str, Any]:
    return {
        "warehouse_id": sale.warehouse_id,
        "location_id": sale.location_id,
        "terminal_id": sale.terminal_id,
        "status": sale.status,
        "notes": sale.notes,
        "cashier_user_id": sale.cashier_user_id,
        "cashier_name": sale.cashier_name,
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


async def _get_sale_for_update(session: AsyncSession, sale_id: int) -> Sale:
    """Load and lock the aggregate that owns any draft state change.

    Under PostgreSQL READ COMMITTED, a waiter sees the row version committed
    by the previous owner of the lock. ``populate_existing`` also prevents a
    stale identity-map instance from retaining its old ``DRAFT`` state.
    """
    statement = (
        select(Sale)
        .where(Sale.id == sale_id)
        .options(*_SALE_OPTIONS)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    sale = (await session.execute(statement)).scalar_one_or_none()
    if sale is None:
        raise NotFoundError(f"Sale {sale_id} not found.")
    return sale


async def _assert_sale_stock_available(session: AsyncSession, sale: Sale) -> None:
    """Advisory stock check before opening the POS payment screen.

    It deliberately does not lock or reserve stock. A different terminal can
    still complete a sale before this one does, so ``checkout`` repeats the
    same rule under row locks as the authoritative final check.
    """
    if await _allows_negative_stock(session):
        return

    required_by_product: dict[int, tuple[str, Decimal]] = {}
    for line in sale.lines:
        if not line.tracks_stock:
            continue
        name, quantity = required_by_product.get(line.product_id, (line.product_name, Decimal(0)))
        required_by_product[line.product_id] = name, quantity + line.quantity_base

    for product_id, (product_name, required) in sorted(required_by_product.items()):
        available = await inventory_service.get_available_quantity(
            session,
            product_id=product_id,
            warehouse_id=sale.warehouse_id,
            location_id=sale.location_id,
        )
        if available < required:
            raise _insufficient_stock_error(
                product_name=product_name, required=required, available=available
            )


async def _assert_pos_terminal(
    session: AsyncSession,
    sale: Sale,
    terminal_id: int | None,
    *,
    require_active: bool = True,
    lock_terminal: bool = True,
) -> None:
    """Reject POS access that is absent, cross-terminal or no longer active.

    Legacy/non-POS sales have no terminal and retain the pre-A9 generic API
    path. Once a sale has a terminal, however, every normal POS mutation must
    carry that same identity. This check is called only after the Sale row is
    locked for mutations, so terminal ownership and state are not read from a
    stale aggregate.
    """
    if sale.terminal_id is None:
        if terminal_id is not None:
            raise ConflictError(f"Sale {sale.id} is not assigned to a POS terminal.")
        return
    if terminal_id is None:
        raise ConflictError(f"Sale {sale.id} requires its POS terminal identity.")
    if sale.terminal_id != terminal_id:
        raise ConflictError(f"Sale {sale.id} belongs to a different POS terminal.")
    terminal = await pos_service.get_terminal(session, terminal_id, for_update=lock_terminal)
    if terminal.warehouse_id != sale.warehouse_id:
        raise ConflictError(f"Sale {sale.id} has an invalid POS terminal assignment.")
    if require_active and not terminal.is_active:
        raise ConflictError(f"POS terminal {terminal_id} is inactive.")


async def validate_sale_stock(
    session: AsyncSession, sale_id: int, *, terminal_id: int | None = None
) -> None:
    """Check a draft's stock before the POS opens payment options.

    This is an advisory read for cashier feedback, not a reservation. The
    authoritative, locking check remains in :func:`checkout`.
    """
    sale = await get_sale(session, sale_id)
    await _assert_pos_terminal(session, sale, terminal_id, lock_terminal=False)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError(f"Cannot check out a sale that is already {sale.status}.")
    if not sale.lines:
        raise ValidationError("Cannot check out a sale with no lines.")
    await _assert_sale_stock_available(session, sale)


async def list_sales(
    session: AsyncSession,
    *,
    status: str | None = None,
    warehouse_id: int | None = None,
    terminal_id: int | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    business_from: datetime | None = None,
    business_to: datetime | None = None,
    number: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Sale]:
    if terminal_id is not None:
        terminal = await pos_service.require_active_terminal(session, terminal_id)
        if warehouse_id is not None and terminal.warehouse_id != warehouse_id:
            raise ValidationError(
                f"POS terminal {terminal_id} does not belong to warehouse {warehouse_id}."
            )
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
    if terminal_id is not None:
        stmt = stmt.where(Sale.terminal_id == terminal_id)
    # Por fecha de apertura: es la que se pregunta ("las de hoy"), y la
    # única que tienen también las que se quedaron sin cobrar.
    if created_from is not None:
        stmt = stmt.where(Sale.created_at >= created_from)
    if created_to is not None:
        stmt = stmt.where(Sale.created_at < created_to)
    # A completed sale belongs to the day it was actually charged. Drafts
    # have no completed_at yet, so their commercial day remains the day the
    # cart was opened.
    business_instant = func.coalesce(Sale.completed_at, Sale.created_at)
    if business_from is not None:
        stmt = stmt.where(business_instant >= business_from)
    if business_to is not None:
        stmt = stmt.where(business_instant < business_to)
    if number is not None:
        stmt = stmt.where(Sale.number == number)
    return list((await session.execute(stmt)).scalars())


async def create_sale(session: AsyncSession, payload: SaleCreate) -> Sale:
    terminal = None
    if payload.terminal_id is not None:
        terminal = await pos_service.require_active_terminal(
            session, payload.terminal_id, for_update=True
        )
        if terminal.warehouse_id != payload.warehouse_id:
            raise ValidationError(
                f"POS terminal {terminal.id} does not belong to warehouse {payload.warehouse_id}."
            )
    await inventory_service.validate_stock_location(
        session, warehouse_id=payload.warehouse_id, location_id=payload.location_id
    )

    sale = Sale(
        warehouse_id=payload.warehouse_id,
        location_id=payload.location_id,
        terminal_id=terminal.id if terminal is not None else None,
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
    product = await session.get(Product, product_id, options=[selectinload(Product.category)])
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
    unit_price: Decimal | None = None,
    cold_drink_surcharge: Decimal = Decimal(0),
) -> SaleLine:
    return SaleLine(
        sale_id=sale_id,
        product_id=product.id,
        product_sku=product.sku,
        product_name=product.name,
        product_category_id=product.category_id,
        product_category_name=product.category.name if product.category is not None else None,
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
        unit_price=product.list_price if unit_price is None else unit_price,
        cold_drink_surcharge=cold_drink_surcharge,
        unit_cost=product.cost,
        tracks_stock=catalog_stock.tracks_stock(product),
        track_lots=product.track_lots,
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
            and existing.product_sku == line.product_sku
            and existing.product_name == line.product_name
            and existing.product_category_id == line.product_category_id
            and existing.product_category_name == line.product_category_name
            and existing.unit_cost == line.unit_cost
            and existing.tracks_stock == line.tracks_stock
            and existing.track_lots == line.track_lots
            and existing.cold_drink_surcharge == line.cold_drink_surcharge
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


async def _open_price_unit_price(
    session: AsyncSession, *, total: Decimal, tax_rate: Decimal
) -> Decimal:
    """Convert a cashier-entered final amount to the line's price basis.

    The POS always asks for the amount the customer pays. When catalogue
    prices are net, the stored unit price must be net too so every existing
    tax, report, return and ticket calculation keeps its established
    semantics.
    """
    settings = await pricing_service.get_settings(session)
    if settings.prices_include_tax:
        return _q(total)
    return _q(total / (Decimal(1) + tax_rate / Decimal(100)))


async def _cold_drink_surcharge(
    session: AsyncSession, *, selected: bool, tax_rate: Decimal
) -> Decimal:
    """Resolve the configured final cold-drink amount into line price basis."""
    if not selected:
        return Decimal(0)
    configured = Decimal(
        str(await settings_store.get_value(session, "pos.cold_drink_surcharge_amount"))
    )
    if configured <= 0:
        raise ValidationError(
            "Configura un importe mayor que cero para el recargo de bebida fría en Terminales POS."
        )
    return await _open_price_unit_price(session, total=configured, tax_rate=tax_rate)


async def add_line(
    session: AsyncSession,
    sale_id: int,
    payload: SaleLineCreate,
    *,
    terminal_id: int | None = None,
) -> Sale:
    sale = await _get_sale_for_update(session, sale_id)
    await _assert_pos_terminal(session, sale, terminal_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError("Lines can only be added to a draft sale.")
    product = await _sellable_product_or_422(session, payload.product_id)
    package = await _package_or_422(session, payload.product_id, payload.package_id)
    await _assert_discount_allowed(session, payload.discount_rate)
    tax_rate = await pricing_service.effective_tax_rate_for(session, product.id)
    unit_price: Decimal | None = None
    if product.is_open_price:
        if payload.open_price_total is None:
            raise ValidationError("This POS button requires an entered total price.")
        if not package.is_base or payload.quantity_packages != Decimal(1):
            raise ValidationError("An open-price POS button must be sold as one base unit.")
        unit_price = await _open_price_unit_price(
            session, total=payload.open_price_total, tax_rate=tax_rate
        )
    elif payload.open_price_total is not None:
        raise ValidationError("Only an open-price POS button accepts an entered price.")
    cold_drink_surcharge = await _cold_drink_surcharge(
        session, selected=payload.cold_drink, tax_rate=tax_rate
    )

    line = _add_or_merge(
        sale,
        _new_line(
            sale_id=sale_id,
            product=product,
            package=package,
            quantity_packages=payload.quantity_packages,
            discount_rate=payload.discount_rate,
            tax_rate=tax_rate,
            unit_price=unit_price,
            cold_drink_surcharge=cold_drink_surcharge,
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
            "open_price_total": (
                str(payload.open_price_total) if payload.open_price_total is not None else None
            ),
            "cold_drink_surcharge": str(cold_drink_surcharge),
        },
    )
    return await get_sale(session, sale_id)


async def add_line_by_barcode(
    session: AsyncSession,
    sale_id: int,
    payload: SaleLineByBarcodeCreate,
    *,
    terminal_id: int | None = None,
) -> Sale:
    sale = await _get_sale_for_update(session, sale_id)
    await _assert_pos_terminal(session, sale, terminal_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError("Lines can only be added to a draft sale.")

    product, package = await catalog_service.get_product_by_barcode(session, payload.barcode)
    await _assert_discount_allowed(session, payload.discount_rate)
    if not product.is_active:
        raise ValidationError(f"Product {product.id} is deactivated and cannot be sold.")
    tax_rate = await pricing_service.effective_tax_rate_for(session, product.id)
    cold_drink_surcharge = await _cold_drink_surcharge(
        session, selected=payload.cold_drink, tax_rate=tax_rate
    )

    line = _add_or_merge(
        sale,
        _new_line(
            sale_id=sale_id,
            product=product,
            package=package,
            quantity_packages=payload.quantity_packages,
            discount_rate=payload.discount_rate,
            tax_rate=tax_rate,
            cold_drink_surcharge=cold_drink_surcharge,
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
            "cold_drink_surcharge": str(cold_drink_surcharge),
        },
    )
    return await get_sale(session, sale_id)


async def remove_line(
    session: AsyncSession,
    sale_id: int,
    line_id: int,
    *,
    terminal_id: int | None = None,
) -> Sale:
    sale = await _get_sale_for_update(session, sale_id)
    await _assert_pos_terminal(session, sale, terminal_id)
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


async def cancel_sale(
    session: AsyncSession, sale_id: int, *, terminal_id: int | None = None
) -> None:
    """Cancelar un carrito lo borra, no lo deja marcado.

    Sólo se puede cancelar un borrador, y un borrador no ha tocado nada:
    ni stock (eso pasa al cobrar), ni cobro, ni ticket. Así que no queda
    nada colgando al borrarlo, y a cambio no ensucia la lista de ventas ni
    se lleva un número por delante.

    De que existió queda constancia en el registro de auditoría, como de
    cualquier otro borrado de la aplicación.
    """
    sale = await _get_sale_for_update(session, sale_id)
    await _assert_pos_terminal(session, sale, terminal_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError(f"Cannot cancel a sale that is already {sale.status}.")

    before = _sale_snapshot(sale)
    await session.delete(sale)
    await session.flush()
    await audit.record(
        session,
        action="cancelled",
        entity_type="sale",
        entity_id=sale_id,
        before={**before, "lines": len(sale.lines)},
    )


async def _next_sale_number(session: AsyncSession) -> int:
    """El siguiente número correlativo, sin huecos.

    Se toma un cerrojo de transacción antes de mirar el máximo: dos cajas
    cobrando a la vez leerían el mismo y una de las dos se estrellaría
    contra el índice único. Un `SEQUENCE` de Postgres sería más simple pero
    deja huecos cuando una transacción se echa atrás, y el número del
    ticket no puede saltarse ninguno.
    """
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext('sale_number'))"))
    highest = (await session.execute(select(func.max(Sale.number)))).scalar_one_or_none()
    return (highest or 0) + 1


def checkout_request_fingerprint(sale_id: int, payload: CheckoutRequest) -> str:
    """SHA-256 of the checkout's canonical economic input.

    Object-key and payment-list ordering are irrelevant. Decimal spellings
    such as ``10``, ``10.0`` and ``10.000000`` describe the same tender and
    therefore produce the same fingerprint; duplicate tenders remain
    duplicate entries and are not merged.
    """
    payments = sorted(
        (
            {"method": payment.method, "amount": format(_q(payment.amount), "f")}
            for payment in payload.payments
        ),
        key=lambda payment: (payment["method"], payment["amount"]),
    )
    canonical = json.dumps(
        {"sale_id": sale_id, "payments": payments},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def checkout(
    session: AsyncSession,
    sale_id: int,
    payload: CheckoutRequest,
    *,
    idempotency_key: str | None = None,
    actor_user_id: int | None = None,
    terminal_id: int | None = None,
) -> Sale:
    # The router supplies this from CurrentUser. It is deliberately not part
    # of CheckoutRequest: a browser may choose a physical terminal, but it
    # may never choose the identity of the cashier using it.
    checkout_actor_id = actor_user_id if actor_user_id is not None else get_user_id()
    claim = None
    if idempotency_key is not None:
        if checkout_actor_id is None:
            raise ValidationError("An authenticated user is required for an idempotent checkout.")
        claim = await idempotency_service.claim(
            session,
            operation=_CHECKOUT_OPERATION,
            idempotency_key=idempotency_key,
            request_fingerprint=checkout_request_fingerprint(sale_id, payload),
            resource_id=sale_id,
            actor_user_id=checkout_actor_id,
        )
        if not claim.is_new:
            completed = await get_sale(session, claim.record.resource_id)
            await _assert_pos_terminal(
                session,
                completed,
                terminal_id,
                require_active=False,
                lock_terminal=False,
            )
            if completed.status != SaleStatus.COMPLETED:
                raise ConflictError("The idempotent checkout result is not available.")
            return completed

    warehouse_id = await session.scalar(select(Sale.warehouse_id).where(Sale.id == sale_id))
    if warehouse_id is None:
        raise NotFoundError(f"Sale {sale_id} not found.")
    await accounting.lock_warehouse_cut(session, warehouse_id)

    sale = await _get_sale_for_update(session, sale_id)
    await _assert_pos_terminal(session, sale, terminal_id)
    if sale.status != SaleStatus.DRAFT:
        raise ConflictError(f"Cannot check out a sale that is already {sale.status}.")
    if not sale.lines:
        raise ValidationError("Cannot check out a sale with no lines.")
    if sale.terminal_id is not None and checkout_actor_id is None:
        raise ValidationError("An authenticated user is required to check out a POS sale.")

    effective_cashier = None
    if checkout_actor_id is not None:
        effective_cashier = await session.get(User, checkout_actor_id)
        if effective_cashier is None:
            raise ValidationError("The authenticated checkout user no longer exists.")
    elif sale.cashier_user_id is not None:
        # Preserve the historical generic/non-POS service boundary for
        # trusted callers without request context. Browser POS checkouts are
        # covered by the authenticated branch above.
        effective_cashier = await session.get(User, sale.cashier_user_id)
        assert effective_cashier is not None  # foreign key invariant

    prices_include_tax = (await pricing_service.get_settings(session)).prices_include_tax
    sale_total = payable(
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
    allow_negative_stock = await _allows_negative_stock(session)

    # Rule 5: lock, check and decrement every line's stock *before* the sale
    # is marked COMPLETED — any ConflictError below rolls back this whole
    # request (nothing partially deducted), and nothing here has mutated
    # the sale itself yet, so a DRAFT sale that fails checkout is exactly
    # as it was, ready to retry (e.g. after a restock).
    # Every checkout acquires resources in this order:
    # idempotency key -> warehouse accounting cut -> Sale -> stock groups by
    # product id -> balance rows by id -> global sale-number advisory lock.
    # Sorting here means two sales with the same products cannot deadlock
    # merely because their lines were scanned in opposite orders.
    stock_lines = sorted(
        (line for line in sale.lines if line.tracks_stock),
        key=lambda line: (line.product_id, line.id),
    )
    for line in stock_lines:
        # Lo que no lleva control de existencias no se agota ni mueve el
        # almacén: se vende y ya (ver `app.catalog.stock`). Se sigue
        # cobrando y saliendo en el ticket y en la Z, que es lo que importa
        # para el dinero.
        available = await inventory_service.lock_and_get_available_quantity(
            session,
            product_id=line.product_id,
            warehouse_id=sale.warehouse_id,
            location_id=sale.location_id,
        )
        if available < line.quantity_base and not allow_negative_stock:
            raise _insufficient_stock_error(
                product_name=line.product_name,
                required=line.quantity_base,
                available=available,
            )

        if line.track_lots:
            await lots_service.execute_fefo_consumption(
                session,
                product_id=line.product_id,
                warehouse_id=sale.warehouse_id,
                location_id=sale.location_id,
                quantity=line.quantity_base,
                movement_type=MovementType.SALE,
                unit_cost=line.unit_cost,
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
                unit_cost=line.unit_cost,
                reference_type="sale",
                reference_id=sale.id,
                allow_negative=allow_negative_stock,
            )

    for tender in payload.payments:
        session.add(Payment(sale_id=sale.id, method=tender.method, amount=tender.amount))

    before = _sale_snapshot(sale)
    sale.status = SaleStatus.COMPLETED
    sale.completed_at = await accounting.database_clock(session)
    sale.prices_include_tax = prices_include_tax
    if effective_cashier is not None:
        sale.cashier_user_id = effective_cashier.id
        sale.cashier_name = effective_cashier.full_name
    sale.number = await _next_sale_number(session)
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
    if claim is not None:
        await idempotency_service.complete(session, claim.record)
    return await get_sale(session, sale_id)
