"""Purchase order management.

Only ``DRAFT -> ORDERED -> CANCELLED`` is driven here — see the module
docstring in ``app.purchasing`` for why ``PARTIALLY_RECEIVED``/``RECEIVED``
belong to phase 9.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.catalog import stock as catalog_stock
from app.catalog.models import Product, ProductPackage
from app.core.context import get_user_id
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.types import NUMERIC_EPSILON
from app.idempotency import service as idempotency_service
from app.inventory import service as inventory_service
from app.lots import service as lots_service
from app.lots.schemas import LotCreate
from app.pricing import service as pricing_service
from app.purchasing.models import (
    GoodsReceipt,
    GoodsReceiptLine,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseOrderStatus,
)
from app.purchasing.schemas import (
    ApplyReceivedCostsRequest,
    GoodsReceiptCreate,
    GoodsReceiptLineCreate,
    PurchaseOrderCreate,
    PurchaseOrderLineCreate,
)
from app.suppliers.models import Supplier

_ORDER_OPTIONS = (
    selectinload(PurchaseOrder.supplier),
    selectinload(PurchaseOrder.lines)
    .selectinload(PurchaseOrderLine.product)
    .selectinload(Product.category),
    selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.package),
)

_PLACE_ORDER_OPERATION = "purchase.place_order"
_RECEIVE_OPERATION = "purchase.receive"


@dataclass(frozen=True)
class LineTotals:
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total: Decimal


def _q(value: Decimal) -> Decimal:
    """Quantize to the same NUMERIC(18,6) scale every stored money/quantity
    column uses. Multiplying two 6-decimal-place Decimals is exact but
    yields up to 12 places (rule 8 requires Decimal, not that it be
    unrounded) — quantizing keeps computed and stored figures consistently
    formatted throughout the API."""
    return value.quantize(NUMERIC_EPSILON)


def compute_line_totals(line: PurchaseOrderLine) -> LineTotals:
    """Deterministic from the line's own snapshots — never stored, so there
    is nothing that could drift out of sync with them."""
    subtotal = line.quantity_packages * line.unit_cost
    discount_amount = subtotal * line.discount_rate / Decimal(100)
    net = subtotal - discount_amount
    tax_amount = net * line.tax_rate / Decimal(100)
    return LineTotals(
        subtotal=_q(subtotal),
        discount_amount=_q(discount_amount),
        tax_amount=_q(tax_amount),
        total=_q(net + tax_amount),
    )


def _order_snapshot(order: PurchaseOrder) -> dict[str, Any]:
    return {"supplier_id": order.supplier_id, "status": order.status, "notes": order.notes}


async def get_order(session: AsyncSession, order_id: int) -> PurchaseOrder:
    stmt = (
        select(PurchaseOrder)
        .where(PurchaseOrder.id == order_id)
        .options(*_ORDER_OPTIONS)
        .execution_options(populate_existing=True)
    )
    order = (await session.execute(stmt)).scalar_one_or_none()
    if order is None:
        raise NotFoundError(f"Purchase order {order_id} not found.")
    return order


async def _get_order_for_update(session: AsyncSession, order_id: int) -> PurchaseOrder:
    """Lock and refresh the aggregate that owns ordering/receiving state."""
    stmt = (
        select(PurchaseOrder)
        .where(PurchaseOrder.id == order_id)
        .options(*_ORDER_OPTIONS)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    order = (await session.execute(stmt)).scalar_one_or_none()
    if order is None:
        raise NotFoundError(f"Purchase order {order_id} not found.")
    return order


async def list_orders(
    session: AsyncSession,
    *,
    supplier_id: int | None = None,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[PurchaseOrder]:
    stmt = (
        select(PurchaseOrder)
        .options(*_ORDER_OPTIONS)
        .order_by(PurchaseOrder.created_at.desc(), PurchaseOrder.id.desc())
        .limit(limit)
        .offset(offset)
    )
    if supplier_id is not None:
        stmt = stmt.where(PurchaseOrder.supplier_id == supplier_id)
    if status is not None:
        stmt = stmt.where(PurchaseOrder.status == status)
    return list((await session.execute(stmt)).scalars())


async def _supplier_or_422(session: AsyncSession, supplier_id: int) -> Supplier:
    supplier = await session.get(Supplier, supplier_id)
    if supplier is None:
        raise ValidationError(f"Supplier {supplier_id} does not exist.")
    return supplier


async def create_order(session: AsyncSession, payload: PurchaseOrderCreate) -> PurchaseOrder:
    await _supplier_or_422(session, payload.supplier_id)

    # Validate every selected product/unit before creating the aggregate.
    # A multi-line screen is one user action and must not persist a partial
    # order when one of its rows is incoherent.
    packages = [
        await _package_or_422(session, line.product_id, line.package_id) for line in payload.lines
    ]

    order = PurchaseOrder(
        supplier_id=payload.supplier_id, notes=payload.notes, created_by_user_id=get_user_id()
    )
    session.add(order)
    await session.flush()
    for line_payload, package in zip(payload.lines, packages, strict=True):
        session.add(_new_line(order.id, line_payload, package))
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="purchase_order",
        entity_id=order.id,
        after={**_order_snapshot(order), "lines_count": len(payload.lines)},
    )
    return await get_order(session, order.id)


async def _package_or_422(
    session: AsyncSession, product_id: int, package_id: int
) -> ProductPackage:
    package = await session.get(ProductPackage, package_id)
    if package is None or package.product_id != product_id:
        raise ValidationError(f"Package {package_id} does not belong to product {product_id}.")
    return package


def _new_line(
    order_id: int, payload: PurchaseOrderLineCreate, package: ProductPackage
) -> PurchaseOrderLine:
    return PurchaseOrderLine(
        purchase_order_id=order_id,
        product_id=payload.product_id,
        package_id=payload.package_id,
        package_name=package.name,
        package_factor=package.factor,
        quantity_packages=payload.quantity_packages,
        quantity_ordered=payload.quantity_packages * package.factor,
        unit_cost=payload.unit_cost,
        tax_rate=payload.tax_rate,
        discount_rate=payload.discount_rate,
    )


def _line_snapshot(line: PurchaseOrderLine) -> dict[str, str | int]:
    return {
        "line_id": line.id,
        "product_id": line.product_id,
        "package": line.package_name,
        "quantity_packages": str(line.quantity_packages),
        "unit_cost": str(line.unit_cost),
        "tax_rate": str(line.tax_rate),
        "discount_rate": str(line.discount_rate),
    }


async def add_line(
    session: AsyncSession, order_id: int, payload: PurchaseOrderLineCreate
) -> PurchaseOrder:
    order = await _get_order_for_update(session, order_id)
    if order.status != PurchaseOrderStatus.DRAFT:
        raise ConflictError("Lines can only be added to a draft purchase order.")
    package = await _package_or_422(session, payload.product_id, payload.package_id)

    line = _new_line(order_id, payload, package)
    session.add(line)
    await session.flush()
    await audit.record(
        session,
        action="line_added",
        entity_type="purchase_order",
        entity_id=order_id,
        after={
            "product_id": payload.product_id,
            "package": package.name,
            "quantity_packages": str(payload.quantity_packages),
        },
    )
    return await get_order(session, order_id)


async def update_line(
    session: AsyncSession, order_id: int, line_id: int, payload: PurchaseOrderLineCreate
) -> PurchaseOrder:
    """Correct one draft line before it can affect a supplier order or stock."""
    order = await _get_order_for_update(session, order_id)
    if order.status != PurchaseOrderStatus.DRAFT:
        raise ConflictError("Lines can only be edited on a draft purchase order.")
    line = next((candidate for candidate in order.lines if candidate.id == line_id), None)
    if line is None:
        raise NotFoundError(f"Line {line_id} not found on order {order_id}.")
    package = await _package_or_422(session, payload.product_id, payload.package_id)
    before = _line_snapshot(line)

    line.product_id = payload.product_id
    line.package_id = payload.package_id
    line.package_name = package.name
    line.package_factor = package.factor
    line.quantity_packages = payload.quantity_packages
    line.quantity_ordered = payload.quantity_packages * package.factor
    line.unit_cost = payload.unit_cost
    line.tax_rate = payload.tax_rate
    line.discount_rate = payload.discount_rate
    await session.flush()
    await audit.record(
        session,
        action="line_updated",
        entity_type="purchase_order",
        entity_id=order_id,
        before=before,
        after=_line_snapshot(line),
    )
    return await get_order(session, order_id)


async def remove_line(session: AsyncSession, order_id: int, line_id: int) -> PurchaseOrder:
    order = await _get_order_for_update(session, order_id)
    if order.status != PurchaseOrderStatus.DRAFT:
        raise ConflictError("Lines can only be removed from a draft purchase order.")
    line = next((candidate for candidate in order.lines if candidate.id == line_id), None)
    if line is None:
        raise NotFoundError(f"Line {line_id} not found on order {order_id}.")

    await session.delete(line)
    await session.flush()
    await audit.record(
        session,
        action="line_removed",
        entity_type="purchase_order",
        entity_id=order_id,
        before={"line_id": line_id},
    )
    return await get_order(session, order_id)


def place_order_request_fingerprint(order_id: int) -> str:
    canonical = json.dumps({"purchase_order_id": order_id}, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def place_order(
    session: AsyncSession,
    order_id: int,
    *,
    idempotency_key: str | None = None,
    actor_user_id: int | None = None,
) -> PurchaseOrder:
    claim = None
    if idempotency_key is not None:
        actor_id = actor_user_id if actor_user_id is not None else get_user_id()
        if actor_id is None:
            raise ValidationError("An authenticated user is required for an idempotent order.")
        claim = await idempotency_service.claim(
            session,
            operation=_PLACE_ORDER_OPERATION,
            idempotency_key=idempotency_key,
            request_fingerprint=place_order_request_fingerprint(order_id),
            resource_id=order_id,
            actor_user_id=actor_id,
        )
        if not claim.is_new:
            # The order may legitimately have progressed to partially or
            # fully received since the original response. The completed
            # record proves that this transition ran; replay returns the
            # same persisted aggregate in its current state.
            return await get_order(session, claim.record.resource_id)

    order = await _get_order_for_update(session, order_id)
    if order.status != PurchaseOrderStatus.DRAFT:
        raise ConflictError(f"Only a draft order can be placed (current status: {order.status}).")
    if not order.lines:
        raise ValidationError("Cannot place an order with no lines.")

    before = _order_snapshot(order)
    order.status = PurchaseOrderStatus.ORDERED
    order.ordered_at = datetime.now(UTC)
    await session.flush()
    await audit.record(
        session,
        action="ordered",
        entity_type="purchase_order",
        entity_id=order_id,
        before=before,
        after=_order_snapshot(order),
    )
    if claim is not None:
        await idempotency_service.complete(session, claim.record)
    return await get_order(session, order_id)


async def cancel_order(session: AsyncSession, order_id: int) -> PurchaseOrder:
    order = await _get_order_for_update(session, order_id)
    if order.status not in (PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.ORDERED):
        raise ConflictError(f"Cannot cancel an order that is already {order.status}.")

    before = _order_snapshot(order)
    order.status = PurchaseOrderStatus.CANCELLED
    await session.flush()
    await audit.record(
        session,
        action="cancelled",
        entity_type="purchase_order",
        entity_id=order_id,
        before=before,
        after=_order_snapshot(order),
    )
    return await get_order(session, order_id)


async def product_purchase_history(
    session: AsyncSession, product_id: int
) -> list[PurchaseOrderLine]:
    """Every line ever ordered for this product, most recent order first —
    date, supplier, quantity, price, presentation (spec: consultable from
    the product record)."""
    stmt = (
        select(PurchaseOrderLine)
        .join(PurchaseOrder)
        .where(PurchaseOrderLine.product_id == product_id)
        .options(
            selectinload(PurchaseOrderLine.purchase_order).selectinload(PurchaseOrder.supplier)
        )
        .order_by(PurchaseOrder.created_at.desc(), PurchaseOrderLine.id.desc())
    )
    return list((await session.execute(stmt)).scalars())


# --- goods receipts (phase 9) --------------------------------------------------

_RECEIPT_OPTIONS = (
    selectinload(GoodsReceipt.lines)
    .selectinload(GoodsReceiptLine.purchase_order_line)
    .selectinload(PurchaseOrderLine.product),
    selectinload(GoodsReceipt.lines).selectinload(GoodsReceiptLine.lot),
)


async def get_goods_receipt(session: AsyncSession, receipt_id: int) -> GoodsReceipt:
    stmt = (
        select(GoodsReceipt)
        .where(GoodsReceipt.id == receipt_id)
        .options(*_RECEIPT_OPTIONS)
        .execution_options(populate_existing=True)
    )
    receipt = (await session.execute(stmt)).scalar_one_or_none()
    if receipt is None:
        raise NotFoundError(f"Goods receipt {receipt_id} not found.")
    return receipt


async def _get_goods_receipt_for_update(session: AsyncSession, receipt_id: int) -> GoodsReceipt:
    """First lock in the B10 order: receipt, then products by id, then pricing.

    A receipt is immutable once created, but locking it makes the aggregate
    boundary and the lock order explicit for the subsequent cost confirmation.
    """
    stmt = (
        select(GoodsReceipt)
        .where(GoodsReceipt.id == receipt_id)
        .options(*_RECEIPT_OPTIONS)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    receipt = (await session.execute(stmt)).scalar_one_or_none()
    if receipt is None:
        raise NotFoundError(f"Goods receipt {receipt_id} not found.")
    return receipt


def received_unit_cost(line: GoodsReceiptLine) -> Decimal:
    """The persisted PO snapshot converted from package to base-unit cost."""
    return (line.purchase_order_line.unit_cost / line.purchase_order_line.package_factor).quantize(
        NUMERIC_EPSILON
    )


def receipt_cost_proposals(receipt: GoodsReceipt) -> list[tuple[GoodsReceiptLine, Decimal]]:
    """Return only receipt-line costs that still differ from catalog cost."""
    proposals: list[tuple[GoodsReceiptLine, Decimal]] = []
    for line in receipt.lines:
        cost = received_unit_cost(line)
        if cost != line.purchase_order_line.product.cost:
            proposals.append((line, cost))
    return proposals


async def apply_received_costs(
    session: AsyncSession,
    receipt_id: int,
    payload: ApplyReceivedCostsRequest,
) -> GoodsReceipt:
    """Confirm selected catalog costs from a completed receipt.

    Lock order is Receipt -> Product ids ascending -> pricing recomputation.
    The source cost is only ever the persisted purchase-order-line snapshot;
    the request carries an optimistic expected catalog cost, never a price.
    """
    receipt = await _get_goods_receipt_for_update(session, receipt_id)
    receipt_lines = {line.id: line for line in receipt.lines}
    requested_ids = [line.receipt_line_id for line in payload.lines]
    if len(requested_ids) != len(set(requested_ids)):
        raise ValidationError("Each receipt line can be selected only once.")

    selected: list[tuple[GoodsReceiptLine, Decimal, Decimal]] = []
    for request_line in payload.lines:
        receipt_line = receipt_lines.get(request_line.receipt_line_id)
        if receipt_line is None:
            raise ValidationError(
                f"Receipt line {request_line.receipt_line_id} does not belong to "
                f"receipt {receipt_id}."
            )
        selected.append(
            (receipt_line, received_unit_cost(receipt_line), request_line.expected_current_cost)
        )

    product_ids = [line.purchase_order_line.product_id for line, _, _ in selected]
    if len(product_ids) != len(set(product_ids)):
        raise ValidationError("Select at most one received cost for each product.")

    products = await pricing_service.get_products_for_update(session, sorted(product_ids))
    products_by_id = {product.id: product for product in products}

    # Validate all optimistic expectations before changing any product, so a
    # partial selection remains one all-or-nothing commercial decision.
    for receipt_line, received_cost, expected_cost in selected:
        product = products_by_id[receipt_line.purchase_order_line.product_id]
        if product.cost == received_cost:
            continue  # Natural idempotent replay: there is no second effect.
        if product.cost != expected_cost:
            raise ConflictError(
                "The catalog cost changed since this receipt was reviewed; refresh the proposal."
            )

    for receipt_line, received_cost, _ in selected:
        product = products_by_id[receipt_line.purchase_order_line.product_id]
        await pricing_service.apply_received_catalog_cost(
            session,
            product,
            received_cost,
            receipt_id=receipt.id,
        )

    return await get_goods_receipt(session, receipt.id)


async def list_goods_receipts(session: AsyncSession, purchase_order_id: int) -> list[GoodsReceipt]:
    stmt = (
        select(GoodsReceipt)
        .where(GoodsReceipt.purchase_order_id == purchase_order_id)
        .options(*_RECEIPT_OPTIONS)
        .order_by(GoodsReceipt.received_at.desc())
    )
    return list((await session.execute(stmt)).scalars())


async def _get_or_create_lot(
    session: AsyncSession,
    *,
    product_id: int,
    lot_number: str,
    manufacturing_date: date | None,
    expiration_date: date | None,
    supplier_id: int,
    purchase_order_id: int,
) -> int:
    lot = await lots_service.get_or_create_lot(
        session,
        LotCreate(
            product_id=product_id,
            lot_number=lot_number,
            manufacturing_date=manufacturing_date,
            expiration_date=expiration_date,
            supplier_id=supplier_id,
            purchase_order_id=purchase_order_id,
        ),
    )
    return lot.id


def goods_receipt_request_fingerprint(purchase_order_id: int, payload: GoodsReceiptCreate) -> str:
    """Canonical physical intent for a goods receipt.

    A purchase-order line permanently identifies its product and package
    snapshot once an order is placed, so the line id binds both without an
    unlocked pre-read of the aggregate. Request line ordering is not
    meaningful and Decimal spellings at the storage scale are equivalent.
    """
    ordered_lines = sorted(payload.lines, key=_goods_receipt_line_sort_key)
    lines = [
        {
            "purchase_order_line_id": line.purchase_order_line_id,
            "quantity_packages": format(_q(line.quantity_packages), "f"),
            "lot_number": line.lot_number,
            "manufacturing_date": (
                line.manufacturing_date.isoformat() if line.manufacturing_date else None
            ),
            "expiration_date": line.expiration_date.isoformat() if line.expiration_date else None,
        }
        for line in ordered_lines
    ]
    canonical = json.dumps(
        {
            "purchase_order_id": purchase_order_id,
            "warehouse_id": payload.warehouse_id,
            "location_id": payload.location_id,
            "notes": payload.notes,
            "lines": lines,
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _goods_receipt_line_sort_key(
    line: GoodsReceiptLineCreate,
) -> tuple[int, str, str, str, str]:
    return (
        line.purchase_order_line_id,
        line.lot_number or "",
        line.manufacturing_date.isoformat() if line.manufacturing_date else "",
        line.expiration_date.isoformat() if line.expiration_date else "",
        format(_q(line.quantity_packages), "f"),
    )


async def create_goods_receipt(
    session: AsyncSession,
    purchase_order_id: int,
    payload: GoodsReceiptCreate,
    *,
    idempotency_key: str | None = None,
    actor_user_id: int | None = None,
) -> GoodsReceipt:
    """Record a delivery against a purchase order: one ``PURCHASE_RECEIPT``
    ledger movement per line (rule: a receipt increases inventory), the
    order's ``quantity_received`` updated, and its status recomputed to
    ``PARTIALLY_RECEIVED``/``RECEIVED`` — all in one transaction (rule 5).
    """
    claim = None
    if idempotency_key is not None:
        actor_id = actor_user_id if actor_user_id is not None else get_user_id()
        if actor_id is None:
            raise ValidationError("An authenticated user is required for an idempotent receipt.")
        claim = await idempotency_service.claim(
            session,
            operation=_RECEIVE_OPERATION,
            idempotency_key=idempotency_key,
            request_fingerprint=goods_receipt_request_fingerprint(purchase_order_id, payload),
            resource_id=purchase_order_id,
            actor_user_id=actor_id,
        )
        if not claim.is_new:
            if claim.record.result_resource_id is None:
                raise ConflictError("The idempotent receipt result is not available.")
            return await get_goods_receipt(session, claim.record.result_resource_id)

    order = await _get_order_for_update(session, purchase_order_id)
    if order.status not in (PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED):
        raise ConflictError(f"Cannot receive against an order that is {order.status}.")

    lines_by_id = {line.id: line for line in order.lines}

    # Validate the complete request before creating the receipt or any lot.
    # A non-stock-controlled product has no movement, so it cannot rely on
    # record_movement to catch an incoherent warehouse/location pair.
    await inventory_service.validate_stock_location(
        session, warehouse_id=payload.warehouse_id, location_id=payload.location_id
    )

    def execution_order(line: GoodsReceiptLineCreate) -> tuple[int, str, int]:
        po_line = lines_by_id.get(line.purchase_order_line_id)
        return (
            po_line.product_id if po_line is not None else -1,
            line.lot_number or "",
            line.purchase_order_line_id,
        )

    ordered_line_payloads = sorted(payload.lines, key=execution_order)
    for line_payload in ordered_line_payloads:
        po_line = lines_by_id.get(line_payload.purchase_order_line_id)
        if po_line is None:
            raise ValidationError(
                f"Line {line_payload.purchase_order_line_id} does not belong "
                f"to order {purchase_order_id}."
            )

        remaining_base = po_line.quantity_ordered - po_line.quantity_received
        received_base = line_payload.quantity_packages * po_line.package_factor
        if received_base > remaining_base:
            remaining_packages = remaining_base / po_line.package_factor
            error_type = (
                ConflictError if received_base <= po_line.quantity_ordered else ValidationError
            )
            raise error_type(
                f"Line {po_line.id}: receiving {line_payload.quantity_packages} would exceed "
                f"the {remaining_packages} still pending."
            )

        product = po_line.product
        if catalog_stock.tracks_lots(product) and not line_payload.lot_number:
            raise ValidationError(
                f"Line {po_line.id}: product {po_line.product_id} tracks lots; "
                "lot_number is required."
            )
        if not catalog_stock.tracks_lots(product) and line_payload.lot_number:
            raise ValidationError(
                f"Line {po_line.id}: product {po_line.product_id} does not track lots; "
                "lot_number is forbidden."
            )

    resolved_lot_ids: list[int | None] = []
    for line_payload in ordered_line_payloads:
        po_line = lines_by_id[line_payload.purchase_order_line_id]
        lot_id = None
        if line_payload.lot_number:
            lot_id = await _get_or_create_lot(
                session,
                product_id=po_line.product_id,
                lot_number=line_payload.lot_number,
                manufacturing_date=line_payload.manufacturing_date,
                expiration_date=line_payload.expiration_date,
                supplier_id=order.supplier_id,
                purchase_order_id=purchase_order_id,
            )
        # Validate the concrete lot returned by lookup/creation too. This
        # protects the receipt if that helper or a future caller ever hands
        # back a lot belonging to another product.
        await inventory_service.validate_inventory_context(
            session,
            product_id=po_line.product_id,
            warehouse_id=payload.warehouse_id,
            location_id=payload.location_id,
            lot_id=lot_id,
        )
        resolved_lot_ids.append(lot_id)

    # Global stock lock order shared with checkout/FEFO/returns: product id,
    # then StockBalance primary key inside the inventory helper. Positive
    # upserts do not need an availability check, but taking existing rows
    # first prevents a multi-line receipt from crossing a consumer in the
    # opposite order.
    stock_product_ids: set[int] = set()
    for line_payload in ordered_line_payloads:
        po_line = lines_by_id[line_payload.purchase_order_line_id]
        product = po_line.product
        if catalog_stock.tracks_stock(product):
            stock_product_ids.add(product.id)
    for product_id in sorted(stock_product_ids):
        await inventory_service.lock_and_get_available_quantity(
            session,
            product_id=product_id,
            warehouse_id=payload.warehouse_id,
            location_id=payload.location_id,
        )

    receipt = GoodsReceipt(
        purchase_order_id=purchase_order_id,
        warehouse_id=payload.warehouse_id,
        location_id=payload.location_id,
        notes=payload.notes,
        received_at=datetime.now(UTC),
        created_by_user_id=get_user_id(),
    )
    session.add(receipt)
    await session.flush()

    for line_payload, lot_id in zip(ordered_line_payloads, resolved_lot_ids, strict=True):
        po_line = lines_by_id.get(line_payload.purchase_order_line_id)
        if po_line is None:
            raise ValidationError(
                f"Line {line_payload.purchase_order_line_id} does not belong "
                f"to order {purchase_order_id}."
            )

        remaining_base = po_line.quantity_ordered - po_line.quantity_received
        received_base = line_payload.quantity_packages * po_line.package_factor
        if received_base > remaining_base:
            remaining_packages = remaining_base / po_line.package_factor
            error_type = (
                ConflictError if received_base <= po_line.quantity_ordered else ValidationError
            )
            raise error_type(
                f"Line {po_line.id}: receiving {line_payload.quantity_packages} would exceed "
                f"the {remaining_packages} still pending."
            )

        # Con la categoría, que es de donde puede salir si el producto
        # lleva control de existencias (`app.catalog.stock`).
        product = po_line.product
        # Un producto sin control de existencias no se agota: la venta no
        # le descuenta nada, así que recibirlo tampoco puede sumarle. Si
        # sumara, el saldo sólo crecería —nada lo consume nunca— y en la
        # lista aparecería un número enorme justo en los productos que
        # dijimos que no se cuentan. El pedido, la recepción y el lote
        # quedan registrados igual; lo único que no se apunta es el
        # movimiento de almacén.
        restocks = catalog_stock.tracks_stock(product)

        # Cost per base unit — po_line.unit_cost is per package (rule 6:
        # snapshotted at order time), never recomputed from current cost.
        unit_cost_base = po_line.unit_cost / po_line.package_factor

        movement_id: int | None = None
        if restocks:
            movement = await inventory_service.record_movement(
                session,
                product_id=po_line.product_id,
                warehouse_id=payload.warehouse_id,
                location_id=payload.location_id,
                quantity=received_base,
                movement_type="PURCHASE_RECEIPT",
                unit_cost=unit_cost_base,
                lot_id=lot_id,
                reference_type="goods_receipt",
                reference_id=receipt.id,
            )
            movement_id = movement.id

        po_line.quantity_received = po_line.quantity_received + received_base

        session.add(
            GoodsReceiptLine(
                goods_receipt_id=receipt.id,
                purchase_order_line_id=po_line.id,
                quantity_packages=line_payload.quantity_packages,
                lot_id=lot_id,
                stock_movement_id=movement_id,
            )
        )

    await session.flush()

    if all(line.quantity_received >= line.quantity_ordered for line in order.lines):
        new_status = PurchaseOrderStatus.RECEIVED
    else:
        new_status = PurchaseOrderStatus.PARTIALLY_RECEIVED
    before = _order_snapshot(order)
    order.status = new_status
    await session.flush()

    await audit.record(
        session,
        action="goods_received",
        entity_type="purchase_order",
        entity_id=purchase_order_id,
        before=before,
        after={**_order_snapshot(order), "receipt_id": receipt.id},
    )
    if claim is not None:
        await idempotency_service.complete(session, claim.record, result_resource_id=receipt.id)
    return await get_goods_receipt(session, receipt.id)
