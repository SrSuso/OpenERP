"""Purchase order endpoints. Reading needs ``purchase.read``, writing needs
``purchase.manage``."""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import SessionDep
from app.purchasing import service
from app.purchasing.models import PurchaseOrder, PurchaseOrderLine
from app.purchasing.schemas import (
    ProductPurchaseHistoryEntry,
    PurchaseOrderCreate,
    PurchaseOrderLineCreate,
    PurchaseOrderLineRead,
    PurchaseOrderRead,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import PURCHASE_MANAGE, PURCHASE_READ

router = APIRouter(tags=["purchasing"])

_require_read = Depends(require_permission(PURCHASE_READ))
_require_manage = Depends(require_permission(PURCHASE_MANAGE))


def _line_to_read(line: PurchaseOrderLine) -> PurchaseOrderLineRead:
    totals = service.compute_line_totals(line)
    return PurchaseOrderLineRead(
        id=line.id,
        product_id=line.product_id,
        product_sku=line.product.sku,
        product_name=line.product.name,
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
) -> list[PurchaseOrderRead]:
    orders = await service.list_orders(session, supplier_id=supplier_id, status=status)
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
async def place_order(order_id: int, session: SessionDep) -> PurchaseOrderRead:
    return _order_to_read(await service.place_order(session, order_id))


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
