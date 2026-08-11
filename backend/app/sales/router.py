"""Sale endpoints. Both reading and building a sale need ``sale.manage``/
``sale.read`` — unlike most other modules, ``CASHIER`` holds both, since
ringing up a sale is literally their job (phase 13 adds payment/checkout
endpoints protected the same way)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import SessionDep
from app.pricing.dependencies import PricingSettingsDep
from app.rbac.dependencies import require_permission
from app.rbac.permissions import SALE_MANAGE, SALE_READ
from app.sales import service, z_reports
from app.sales.models import Sale, ZReport
from app.sales.presenters import sale_to_read as _sale_to_read
from app.sales.schemas import (
    CheckoutRequest,
    SaleCreate,
    SaleLineByBarcodeCreate,
    SaleLineCreate,
    SaleRead,
    ZReportPreview,
    ZReportRead,
)

router = APIRouter(tags=["sales"])

_require_read = Depends(require_permission(SALE_READ))
_require_manage = Depends(require_permission(SALE_MANAGE))


def _to_read(sale: Sale, pricing: PricingSettingsDep) -> SaleRead:
    return _sale_to_read(sale, prices_include_tax=pricing.prices_include_tax)


@router.get("/sales", response_model=list[SaleRead], dependencies=[_require_read])
async def list_sales(
    session: SessionDep,
    pricing: PricingSettingsDep,
    status: Annotated[str | None, Query()] = None,
    warehouse_id: Annotated[int | None, Query()] = None,
    #: Rango sobre la fecha de apertura, cerrado por abajo y abierto por
    #: arriba, para poder pedir un día entero sin pelearse con la última
    #: hora: `created_from=2026-08-11&created_to=2026-08-12`.
    created_from: Annotated[datetime | None, Query()] = None,
    created_to: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[SaleRead]:
    sales = await service.list_sales(
        session,
        status=status,
        warehouse_id=warehouse_id,
        created_from=created_from,
        created_to=created_to,
        limit=limit,
        offset=offset,
    )
    return [_to_read(s, pricing) for s in sales]


@router.post("/sales", response_model=SaleRead, status_code=201, dependencies=[_require_manage])
async def create_sale(
    payload: SaleCreate, session: SessionDep, pricing: PricingSettingsDep
) -> SaleRead:
    return _to_read(await service.create_sale(session, payload), pricing)


@router.get("/sales/{sale_id}", response_model=SaleRead, dependencies=[_require_read])
async def get_sale(sale_id: int, session: SessionDep, pricing: PricingSettingsDep) -> SaleRead:
    return _to_read(await service.get_sale(session, sale_id), pricing)


@router.post(
    "/sales/{sale_id}/lines",
    response_model=SaleRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def add_line(
    sale_id: int, payload: SaleLineCreate, session: SessionDep, pricing: PricingSettingsDep
) -> SaleRead:
    return _to_read(await service.add_line(session, sale_id, payload), pricing)


@router.post(
    "/sales/{sale_id}/lines/by-barcode",
    response_model=SaleRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def add_line_by_barcode(
    sale_id: int,
    payload: SaleLineByBarcodeCreate,
    session: SessionDep,
    pricing: PricingSettingsDep,
) -> SaleRead:
    return _to_read(await service.add_line_by_barcode(session, sale_id, payload), pricing)


@router.delete(
    "/sales/{sale_id}/lines/{line_id}", response_model=SaleRead, dependencies=[_require_manage]
)
async def remove_line(
    sale_id: int, line_id: int, session: SessionDep, pricing: PricingSettingsDep
) -> SaleRead:
    return _to_read(await service.remove_line(session, sale_id, line_id), pricing)


@router.post("/sales/{sale_id}/cancel", response_model=SaleRead, dependencies=[_require_manage])
async def cancel_sale(sale_id: int, session: SessionDep, pricing: PricingSettingsDep) -> SaleRead:
    return _to_read(await service.cancel_sale(session, sale_id), pricing)


@router.post("/sales/{sale_id}/checkout", response_model=SaleRead, dependencies=[_require_manage])
async def checkout(
    sale_id: int, payload: CheckoutRequest, session: SessionDep, pricing: PricingSettingsDep
) -> SaleRead:
    return _to_read(await service.checkout(session, sale_id, payload), pricing)


# --- cierre de caja (Z) ------------------------------------------------------


def _z_to_read(report: ZReport) -> ZReportRead:
    return ZReportRead(
        id=report.id,
        warehouse_id=report.warehouse_id,
        number=report.number,
        covers_from=report.covers_from,
        closed_at=report.closed_at,
        sales_count=report.sales_count,
        gross_total=report.gross_total,
        tax_total=report.tax_total,
        discount_total=report.discount_total,
        cash_total=report.cash_total,
        card_total=report.card_total,
        other_total=report.other_total,
        returns_count=report.returns_count,
        returns_total=report.returns_total,
        closed_by_user_id=report.closed_by_user_id,
    )


@router.get("/z-reports", response_model=list[ZReportRead], dependencies=[_require_read])
async def list_z_reports(
    session: SessionDep,
    warehouse_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[ZReportRead]:
    reports = await z_reports.list_reports(session, warehouse_id=warehouse_id, limit=limit)
    return [_z_to_read(r) for r in reports]


@router.get("/z-reports/preview", response_model=ZReportPreview, dependencies=[_require_manage])
async def preview_z_report(
    session: SessionDep, warehouse_id: Annotated[int, Query()]
) -> ZReportPreview:
    """Los totales que tendría la Z si se cerrase ahora. Lo enseña el TPV
    antes de que nadie confirme nada."""
    totals = await z_reports.preview(session, warehouse_id)
    pending = await z_reports.open_sales(session, warehouse_id)
    return ZReportPreview(**totals, open_sales=pending)


@router.post(
    "/z-reports", response_model=ZReportRead, status_code=201, dependencies=[_require_manage]
)
async def close_z_report(session: SessionDep, warehouse_id: Annotated[int, Query()]) -> ZReportRead:
    return _z_to_read(await z_reports.close(session, warehouse_id))
