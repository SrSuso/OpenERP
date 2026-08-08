"""Sale endpoints. Both reading and building a sale need ``sale.manage``/
``sale.read`` — unlike most other modules, ``CASHIER`` holds both, since
ringing up a sale is literally their job (phase 13 adds payment/checkout
endpoints protected the same way)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import SessionDep
from app.rbac.dependencies import require_permission
from app.rbac.permissions import SALE_MANAGE, SALE_READ
from app.sales import service
from app.sales.presenters import sale_to_read as _to_read
from app.sales.schemas import (
    CheckoutRequest,
    SaleCreate,
    SaleLineByBarcodeCreate,
    SaleLineCreate,
    SaleRead,
)

router = APIRouter(tags=["sales"])

_require_read = Depends(require_permission(SALE_READ))
_require_manage = Depends(require_permission(SALE_MANAGE))


@router.get("/sales", response_model=list[SaleRead], dependencies=[_require_read])
async def list_sales(
    session: SessionDep,
    status: Annotated[str | None, Query()] = None,
    warehouse_id: Annotated[int | None, Query()] = None,
) -> list[SaleRead]:
    sales = await service.list_sales(session, status=status, warehouse_id=warehouse_id)
    return [_to_read(s) for s in sales]


@router.post("/sales", response_model=SaleRead, status_code=201, dependencies=[_require_manage])
async def create_sale(payload: SaleCreate, session: SessionDep) -> SaleRead:
    return _to_read(await service.create_sale(session, payload))


@router.get("/sales/{sale_id}", response_model=SaleRead, dependencies=[_require_read])
async def get_sale(sale_id: int, session: SessionDep) -> SaleRead:
    return _to_read(await service.get_sale(session, sale_id))


@router.post(
    "/sales/{sale_id}/lines",
    response_model=SaleRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def add_line(sale_id: int, payload: SaleLineCreate, session: SessionDep) -> SaleRead:
    return _to_read(await service.add_line(session, sale_id, payload))


@router.post(
    "/sales/{sale_id}/lines/by-barcode",
    response_model=SaleRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def add_line_by_barcode(
    sale_id: int, payload: SaleLineByBarcodeCreate, session: SessionDep
) -> SaleRead:
    return _to_read(await service.add_line_by_barcode(session, sale_id, payload))


@router.delete(
    "/sales/{sale_id}/lines/{line_id}", response_model=SaleRead, dependencies=[_require_manage]
)
async def remove_line(sale_id: int, line_id: int, session: SessionDep) -> SaleRead:
    return _to_read(await service.remove_line(session, sale_id, line_id))


@router.post("/sales/{sale_id}/cancel", response_model=SaleRead, dependencies=[_require_manage])
async def cancel_sale(sale_id: int, session: SessionDep) -> SaleRead:
    return _to_read(await service.cancel_sale(session, sale_id))


@router.post("/sales/{sale_id}/checkout", response_model=SaleRead, dependencies=[_require_manage])
async def checkout(sale_id: int, payload: CheckoutRequest, session: SessionDep) -> SaleRead:
    return _to_read(await service.checkout(session, sale_id, payload))
