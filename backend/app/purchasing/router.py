"""Purchase order endpoints. Reading needs ``purchase.read``, writing needs
``purchase.manage``."""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query

from app.auth.dependencies import CurrentUser, SessionDep
from app.catalog import stock as catalog_stock
from app.purchasing import service
from app.purchasing.models import GoodsReceipt, GoodsReceiptLine, PurchaseOrder, PurchaseOrderLine
from app.purchasing.schemas import (
    ApplyReceivedCostsRequest,
    GoodsReceiptCreate,
    GoodsReceiptLineRead,
    GoodsReceiptRead,
    ProductPurchaseHistoryEntry,
    PurchaseOrderCreate,
    PurchaseOrderLineCreate,
    PurchaseOrderLineRead,
    PurchaseOrderRead,
    ReceivedCostProposalRead,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import (
    PRICING_MANAGE,
    PURCHASE_MANAGE,
    PURCHASE_READ,
    RECEIVING_MANAGE,
    RECEIVING_READ,
)

router = APIRouter(tags=["purchasing"])

_require_read = Depends(require_permission(PURCHASE_READ))
_require_manage = Depends(require_permission(PURCHASE_MANAGE))
_require_receiving_read = Depends(require_permission(RECEIVING_READ))
_require_receiving_manage = Depends(require_permission(RECEIVING_MANAGE))
_require_pricing_manage = Depends(require_permission(PRICING_MANAGE))


def _line_to_read(line: PurchaseOrderLine) -> PurchaseOrderLineRead:
    totals = service.compute_line_totals(line)
    return PurchaseOrderLineRead(
        id=line.id,
        product_id=line.product_id,
        product_sku=line.product.sku,
        product_name=line.product.name,
        track_lots=catalog_stock.tracks_lots(line.product),
        package_id=line.package_id,
        package_name=line.package_name,
        package_factor=line.package_factor,
        quantity_packages=line.quantity_packages,
        quantity_ordered=line.quantity_ordered,
        quantity_received=line.quantity_received,
        unit_cost=line.unit_cost,
        tax_rate=line.tax_rate,
        discount_rate=line.discount_rate,
        subtotal=totals.subtotal,
        discount_amount=totals.discount_amount,
        tax_amount=totals.tax_amount,
        total=totals.total,
    )


def _order_to_read(order: PurchaseOrder) -> PurchaseOrderRead:
    lines = [_line_to_read(line) for line in order.lines]
    return PurchaseOrderRead(
        id=order.id,
        supplier_id=order.supplier_id,
        supplier_name=order.supplier.name,
        status=order.status,
        notes=order.notes,
        ordered_at=order.ordered_at,
        created_at=order.created_at,
        lines=lines,
        total=sum((line.total for line in lines), start=Decimal(0)),
    )


@router.get(
    "/purchase-orders", response_model=list[PurchaseOrderRead], dependencies=[_require_read]
)
async def list_orders(
    session: SessionDep,
    supplier_id: Annotated[int | None, Query()] = None,
    status: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[PurchaseOrderRead]:
    orders = await service.list_orders(
        session, supplier_id=supplier_id, status=status, limit=limit, offset=offset
    )
    return [_order_to_read(o) for o in orders]


@router.post(
    "/purchase-orders",
    response_model=PurchaseOrderRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_order(payload: PurchaseOrderCreate, session: SessionDep) -> PurchaseOrderRead:
    return _order_to_read(await service.create_order(session, payload))


@router.get(
    "/purchase-orders/{order_id}", response_model=PurchaseOrderRead, dependencies=[_require_read]
)
async def get_order(order_id: int, session: SessionDep) -> PurchaseOrderRead:
    return _order_to_read(await service.get_order(session, order_id))


@router.post(
    "/purchase-orders/{order_id}/lines",
    response_model=PurchaseOrderRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def add_line(
    order_id: int, payload: PurchaseOrderLineCreate, session: SessionDep
) -> PurchaseOrderRead:
    return _order_to_read(await service.add_line(session, order_id, payload))


@router.put(
    "/purchase-orders/{order_id}/lines/{line_id}",
    response_model=PurchaseOrderRead,
    dependencies=[_require_manage],
)
async def update_line(
    order_id: int, line_id: int, payload: PurchaseOrderLineCreate, session: SessionDep
) -> PurchaseOrderRead:
    return _order_to_read(await service.update_line(session, order_id, line_id, payload))


@router.delete(
    "/purchase-orders/{order_id}/lines/{line_id}",
    response_model=PurchaseOrderRead,
    dependencies=[_require_manage],
)
async def remove_line(order_id: int, line_id: int, session: SessionDep) -> PurchaseOrderRead:
    return _order_to_read(await service.remove_line(session, order_id, line_id))


@router.post(
    "/purchase-orders/{order_id}/place",
    response_model=PurchaseOrderRead,
    dependencies=[_require_manage],
)
async def place_order(
    order_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    idempotency_key: Annotated[
        str | None,
        Header(alias="Idempotency-Key", min_length=1, max_length=200),
    ] = None,
) -> PurchaseOrderRead:
    return _order_to_read(
        await service.place_order(
            session,
            order_id,
            idempotency_key=idempotency_key,
            actor_user_id=current_user.id,
        )
    )


@router.post(
    "/purchase-orders/{order_id}/cancel",
    response_model=PurchaseOrderRead,
    dependencies=[_require_manage],
)
async def cancel_order(order_id: int, session: SessionDep) -> PurchaseOrderRead:
    return _order_to_read(await service.cancel_order(session, order_id))


@router.get(
    "/products/{product_id}/purchase-history",
    response_model=list[ProductPurchaseHistoryEntry],
    dependencies=[_require_read],
)
async def product_purchase_history(
    product_id: int, session: SessionDep
) -> list[ProductPurchaseHistoryEntry]:
    lines = await service.product_purchase_history(session, product_id)
    return [
        ProductPurchaseHistoryEntry(
            purchase_order_id=line.purchase_order_id,
            date=line.purchase_order.ordered_at or line.purchase_order.created_at,
            status=line.purchase_order.status,
            supplier_id=line.purchase_order.supplier_id,
            supplier_name=line.purchase_order.supplier.name,
            package_name=line.package_name,
            quantity_packages=line.quantity_packages,
            unit_cost=line.unit_cost,
        )
        for line in lines
    ]


def _receipt_line_to_read(line: GoodsReceiptLine) -> GoodsReceiptLineRead:
    return GoodsReceiptLineRead(
        id=line.id,
        purchase_order_line_id=line.purchase_order_line_id,
        product_id=line.purchase_order_line.product_id,
        product_sku=line.purchase_order_line.product.sku,
        product_name=line.purchase_order_line.product.name,
        quantity_packages=line.quantity_packages,
        lot_id=line.lot_id,
        lot_number=line.lot.lot_number if line.lot else None,
        stock_movement_id=line.stock_movement_id,
    )


def _receipt_to_read(receipt: GoodsReceipt) -> GoodsReceiptRead:
    return GoodsReceiptRead(
        id=receipt.id,
        purchase_order_id=receipt.purchase_order_id,
        warehouse_id=receipt.warehouse_id,
        location_id=receipt.location_id,
        notes=receipt.notes,
        received_at=receipt.received_at,
        lines=[_receipt_line_to_read(line) for line in receipt.lines],
        cost_proposals=[
            ReceivedCostProposalRead(
                receipt_line_id=line.id,
                product_id=line.purchase_order_line.product_id,
                product_sku=line.purchase_order_line.product.sku,
                product_name=line.purchase_order_line.product.name,
                current_catalog_cost=line.purchase_order_line.product.cost,
                received_unit_cost=received_cost,
                difference=received_cost - line.purchase_order_line.product.cost,
            )
            for line, received_cost in service.receipt_cost_proposals(receipt)
        ],
    )


@router.post(
    "/purchase-orders/{order_id}/receipts",
    response_model=GoodsReceiptRead,
    status_code=201,
    dependencies=[_require_receiving_manage],
)
async def create_goods_receipt(
    order_id: int,
    payload: GoodsReceiptCreate,
    session: SessionDep,
    current_user: CurrentUser,
    idempotency_key: Annotated[
        str | None,
        Header(alias="Idempotency-Key", min_length=1, max_length=200),
    ] = None,
) -> GoodsReceiptRead:
    return _receipt_to_read(
        await service.create_goods_receipt(
            session,
            order_id,
            payload,
            idempotency_key=idempotency_key,
            actor_user_id=current_user.id,
        )
    )


@router.get(
    "/purchase-orders/{order_id}/receipts",
    response_model=list[GoodsReceiptRead],
    dependencies=[_require_receiving_read],
)
async def list_goods_receipts(order_id: int, session: SessionDep) -> list[GoodsReceiptRead]:
    receipts = await service.list_goods_receipts(session, order_id)
    return [_receipt_to_read(r) for r in receipts]


@router.get(
    "/goods-receipts/{receipt_id}",
    response_model=GoodsReceiptRead,
    dependencies=[_require_receiving_read],
)
async def get_goods_receipt(receipt_id: int, session: SessionDep) -> GoodsReceiptRead:
    return _receipt_to_read(await service.get_goods_receipt(session, receipt_id))


@router.post(
    "/goods-receipts/{receipt_id}/apply-costs",
    response_model=GoodsReceiptRead,
    dependencies=[_require_receiving_read, _require_pricing_manage],
)
async def apply_received_costs(
    receipt_id: int, payload: ApplyReceivedCostsRequest, session: SessionDep
) -> GoodsReceiptRead:
    return _receipt_to_read(await service.apply_received_costs(session, receipt_id, payload))
