"""Lot endpoints. Reading needs ``lot.read``; creating lots and recording
FEFO-ordered reductions need ``lot.manage``."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query

from app.auth.dependencies import CurrentUser, SessionDep
from app.core.business_time import business_today
from app.lots import service
from app.lots.models import Lot
from app.lots.schemas import (
    FefoAllocationEntry,
    FefoConsumeRequest,
    FefoConsumeResponse,
    FefoPlanRequest,
    FefoPlanResponse,
    LotBalanceRead,
    LotCreate,
    LotRead,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import LOT_MANAGE, LOT_READ
from app.settings.business_time import get_business_timezone

router = APIRouter(tags=["lots"])

_require_read = Depends(require_permission(LOT_READ))
_require_manage = Depends(require_permission(LOT_MANAGE))


def _lot_to_read(lot: Lot) -> LotRead:
    return LotRead(
        id=lot.id,
        product_id=lot.product_id,
        lot_number=lot.lot_number,
        manufacturing_date=lot.manufacturing_date,
        expiration_date=lot.expiration_date,
        supplier_id=lot.supplier_id,
        purchase_order_id=lot.purchase_order_id,
    )


@router.post("/lots", response_model=LotRead, status_code=201, dependencies=[_require_manage])
async def create_lot(payload: LotCreate, session: SessionDep) -> LotRead:
    return _lot_to_read(await service.create_lot(session, payload))


@router.get("/lots", response_model=list[LotRead], dependencies=[_require_read])
async def list_lots(
    session: SessionDep,
    product_id: Annotated[int | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
    expiration_status: Annotated[Literal["all", "alert", "expired", "undated"], Query()] = "all",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[LotRead]:
    today = (
        business_today(await get_business_timezone(session))
        if expiration_status == "expired"
        else None
    )
    lots = await service.list_lots(
        session,
        product_id=product_id,
        search=search,
        expiration_status=expiration_status,
        today=today,
        limit=limit,
        offset=offset,
    )
    return [_lot_to_read(lot) for lot in lots]


@router.get("/lots/{lot_id}", response_model=LotRead, dependencies=[_require_read])
async def get_lot(lot_id: int, session: SessionDep) -> LotRead:
    return _lot_to_read(await service.get_lot(session, lot_id))


@router.get(
    "/products/{product_id}/lot-balances",
    response_model=list[LotBalanceRead],
    dependencies=[_require_read],
)
async def product_lot_balances(
    product_id: int, warehouse_id: int, location_id: int, session: SessionDep
) -> list[LotBalanceRead]:
    balances = await service.lot_balances(
        session, product_id=product_id, warehouse_id=warehouse_id, location_id=location_id
    )
    return [
        LotBalanceRead(lot=_lot_to_read(balance.lot), quantity=balance.quantity)
        for balance in balances
    ]


@router.post(
    "/products/{product_id}/fefo-plan",
    response_model=FefoPlanResponse,
    dependencies=[_require_read],
)
async def fefo_plan(
    product_id: int, payload: FefoPlanRequest, session: SessionDep
) -> FefoPlanResponse:
    allocations = await service.plan_fefo(
        session,
        product_id=product_id,
        warehouse_id=payload.warehouse_id,
        location_id=payload.location_id,
        quantity=payload.quantity,
    )
    return FefoPlanResponse(
        allocations=[
            FefoAllocationEntry(
                lot_id=a.lot.id,
                lot_number=a.lot.lot_number,
                expiration_date=a.lot.expiration_date,
                quantity=a.quantity,
            )
            for a in allocations
        ]
    )


@router.post(
    "/products/{product_id}/fefo-consume",
    response_model=FefoConsumeResponse,
    status_code=201,
    dependencies=[_require_manage],
)
async def fefo_consume(
    product_id: int,
    payload: FefoConsumeRequest,
    session: SessionDep,
    current_user: CurrentUser,
    idempotency_key: Annotated[
        str | None,
        Header(alias="Idempotency-Key", min_length=1, max_length=200),
    ] = None,
) -> FefoConsumeResponse:
    allocations = await service.execute_manual_fefo_consumption(
        session,
        product_id=product_id,
        payload=payload,
        idempotency_key=idempotency_key,
        actor_user_id=current_user.id,
    )
    return FefoConsumeResponse(
        allocations=[
            FefoAllocationEntry(
                lot_id=a.lot.id,
                lot_number=a.lot.lot_number,
                expiration_date=a.lot.expiration_date,
                quantity=a.quantity,
            )
            for a in allocations
        ],
        movement_ids=[a.movement_id for a in allocations if a.movement_id is not None],
    )
