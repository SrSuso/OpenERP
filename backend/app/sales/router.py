"""Sale endpoints. Both reading and building a sale need ``sale.manage``/
``sale.read`` — unlike most other modules, ``CASHIER`` holds both, since
ringing up a sale is literally their job (phase 13 adds payment/checkout
endpoints protected the same way)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query

from app.auth.dependencies import CurrentUser, SessionDep
from app.core.business_time import business_day_utc_range, require_aware
from app.core.errors import ValidationError
from app.pricing.dependencies import PricingSettingsDep
from app.rbac.dependencies import require_permission
from app.rbac.permissions import SALE_MANAGE, SALE_READ
from app.sales import service, z_reports
from app.sales.models import Sale, ZReport
from app.sales.presenters import sale_to_read as _sale_to_read
from app.sales.schemas import (
    CheckoutRequest,
    PendingSaleRead,
    SaleCreate,
    SaleLineByBarcodeCreate,
    SaleLineCreate,
    SaleRead,
    ZReportPreview,
    ZReportRead,
)
from app.settings.business_time import get_business_timezone

router = APIRouter(tags=["sales"])

_require_read = Depends(require_permission(SALE_READ))
_require_manage = Depends(require_permission(SALE_MANAGE))

PosTerminalHeader = Annotated[
    int | None,
    Header(alias="X-POS-Terminal-ID", ge=1),
]


def _to_read(sale: Sale, pricing: PricingSettingsDep) -> SaleRead:
    return _sale_to_read(sale, prices_include_tax=pricing.prices_include_tax)


@router.get("/sales", response_model=list[SaleRead], dependencies=[_require_read])
async def list_sales(
    session: SessionDep,
    pricing: PricingSettingsDep,
    status: Annotated[str | None, Query()] = None,
    warehouse_id: Annotated[int | None, Query()] = None,
    terminal_id: Annotated[int | None, Query()] = None,
    #: Rango sobre la fecha de apertura, cerrado por abajo y abierto por
    #: arriba, para poder pedir un día entero sin pelearse con la última
    #: hora: `created_from=2026-08-11&created_to=2026-08-12`.
    created_from: Annotated[datetime | None, Query()] = None,
    created_to: Annotated[datetime | None, Query()] = None,
    #: Día lógico de la tienda. A diferencia de los dos límites absolutos
    #: anteriores, el backend lo convierte desde medianoche local hasta la
    #: siguiente medianoche local con la zona comercial configurada.
    business_date: Annotated[date | None, Query()] = None,
    #: El número impreso en el ticket, que es por el que pregunta un
    #: cliente que vuelve — no el `id` interno.
    number: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[SaleRead]:
    for name, value in (("created_from", created_from), ("created_to", created_to)):
        if value is not None:
            try:
                require_aware(value)
            except ValueError as exc:
                raise ValidationError(
                    f"{name} must be an absolute datetime with an explicit timezone offset."
                ) from exc
    if business_date is not None and (created_from is not None or created_to is not None):
        raise ValidationError("business_date cannot be combined with created_from or created_to.")
    business_from = business_to = None
    if business_date is not None:
        business_from, business_to = business_day_utc_range(
            business_date, await get_business_timezone(session)
        )
    sales = await service.list_sales(
        session,
        status=status,
        warehouse_id=warehouse_id,
        terminal_id=terminal_id,
        created_from=created_from,
        created_to=created_to,
        business_from=business_from,
        business_to=business_to,
        number=number,
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
    sale_id: int,
    payload: SaleLineCreate,
    session: SessionDep,
    pricing: PricingSettingsDep,
    pos_terminal_id: PosTerminalHeader = None,
) -> SaleRead:
    return _to_read(
        await service.add_line(session, sale_id, payload, terminal_id=pos_terminal_id), pricing
    )


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
    pos_terminal_id: PosTerminalHeader = None,
) -> SaleRead:
    return _to_read(
        await service.add_line_by_barcode(session, sale_id, payload, terminal_id=pos_terminal_id),
        pricing,
    )


@router.delete(
    "/sales/{sale_id}/lines/{line_id}", response_model=SaleRead, dependencies=[_require_manage]
)
async def remove_line(
    sale_id: int,
    line_id: int,
    session: SessionDep,
    pricing: PricingSettingsDep,
    pos_terminal_id: PosTerminalHeader = None,
) -> SaleRead:
    return _to_read(
        await service.remove_line(session, sale_id, line_id, terminal_id=pos_terminal_id), pricing
    )


@router.post("/sales/{sale_id}/cancel", status_code=204, dependencies=[_require_manage])
async def cancel_sale(
    sale_id: int, session: SessionDep, pos_terminal_id: PosTerminalHeader = None
) -> None:
    """Cancelar un carrito lo borra: no queda venta que devolver."""
    await service.cancel_sale(session, sale_id, terminal_id=pos_terminal_id)


@router.post("/sales/{sale_id}/stock-availability", status_code=204, dependencies=[_require_manage])
async def validate_sale_stock(
    sale_id: int,
    session: SessionDep,
    pos_terminal_id: PosTerminalHeader = None,
) -> None:
    """Advisory availability check before the cashier enters payment."""
    await service.validate_sale_stock(session, sale_id, terminal_id=pos_terminal_id)


@router.post("/sales/{sale_id}/checkout", response_model=SaleRead, dependencies=[_require_manage])
async def checkout(
    sale_id: int,
    payload: CheckoutRequest,
    session: SessionDep,
    pricing: PricingSettingsDep,
    current_user: CurrentUser,
    pos_terminal_id: PosTerminalHeader = None,
    idempotency_key: Annotated[
        str | None,
        Header(alias="Idempotency-Key", min_length=1, max_length=200),
    ] = None,
) -> SaleRead:
    return _to_read(
        await service.checkout(
            session,
            sale_id,
            payload,
            idempotency_key=idempotency_key,
            actor_user_id=current_user.id,
            terminal_id=pos_terminal_id,
        ),
        pricing,
    )


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
    session: SessionDep,
    pricing: PricingSettingsDep,
    warehouse_id: Annotated[int, Query()],
) -> ZReportPreview:
    """La Z diaria, o los totales que tendría si aún no se hubiera cerrado."""
    totals, existing = await z_reports.preview(session, warehouse_id)
    pending = [] if existing is not None else await z_reports.open_sales(session, warehouse_id)
    return ZReportPreview(
        **totals,
        existing_report=_z_to_read(existing) if existing is not None else None,
        open_sales=[
            PendingSaleRead(
                id=sale.id,
                lines_count=len(sale.lines),
                total=sum(
                    (
                        service.compute_line_totals(
                            line, prices_include_tax=pricing.prices_include_tax
                        ).total
                        for line in sale.lines
                    ),
                    Decimal(0),
                ),
            )
            for sale in pending
        ],
    )


@router.post(
    "/z-reports", response_model=ZReportRead, status_code=201, dependencies=[_require_manage]
)
async def close_z_report(
    session: SessionDep,
    current_user: CurrentUser,
    warehouse_id: Annotated[int, Query()],
    idempotency_key: Annotated[
        str | None,
        Header(alias="Idempotency-Key", min_length=1, max_length=200),
    ] = None,
) -> ZReportRead:
    return _z_to_read(
        await z_reports.close(
            session,
            warehouse_id,
            idempotency_key=idempotency_key,
            actor_user_id=current_user.id,
        )
    )
