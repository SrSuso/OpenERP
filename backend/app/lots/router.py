"""Lot endpoints. Reading needs ``lot.read``; creating lots and recording
FEFO-ordered reductions need ``lot.manage``."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query

from app.auth.dependencies import CurrentUser, SessionDep
from app.catalog.service import get_product
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
    LotStockSet,
    LotStockSetRead,
    LotUpdate,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import LOT_MANAGE, LOT_READ

router = APIRouter(tags=["lots"])

_require_read = Depends(require_permission(LOT_READ))
_require_manage = Depends(require_permission(LOT_MANAGE))


async def _lot_to_read(session: SessionDep, lot: Lot) -> LotRead:
    product = await get_product(session, lot.product_id)
    return LotRead(
        id=lot.id,
        product_id=lot.product_id,
        product_sku=product.sku,
        lot_number=lot.lot_number,
        manufacturing_date=lot.manufacturing_date,
        expiration_date=lot.expiration_date,
        supplier_id=lot.supplier_id,
        purchase_order_id=lot.purchase_order_id,
    )


@router.post("/lots", response_model=LotRead, status_code=201, dependencies=[_require_manage])
async def create_lot(payload: LotCreate, session: SessionDep) -> LotRead:
    return await _lot_to_read(session, await service.create_lot(session, payload))


@router.put("/lots/{lot_id}", response_model=LotRead, dependencies=[_require_manage])
async def update_lot(lot_id: int, payload: LotUpdate, session: SessionDep) -> LotRead:
    return await _lot_to_read(session, await service.update_lot(session, lot_id, payload))


@router.delete("/lots/{lot_id}", status_code=204, dependencies=[_require_manage])
async def delete_lot(lot_id: int, session: SessionDep) -> None:
    await service.delete_lot(session, lot_id)


@router.put(
    "/lots/{lot_id}/stock",
    response_model=LotStockSetRead,
    dependencies=[_require_manage],
)
async def set_lot_stock(lot_id: int, payload: LotStockSet, session: SessionDep) -> LotStockSetRead:
    previous_quantity, quantity, movement_id = await service.set_lot_stock(session, lot_id, payload)
    return LotStockSetRead(
        previous_quantity=previous_quantity,
        quantity=quantity,
        adjustment_quantity=quantity - previous_quantity,
        movement_id=movement_id,
    )


@router.get("/lots", response_model=list[LotRead], dependencies=[_require_read])
async def list_lots(
    session: SessionDep,
    product_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[LotRead]:
    lots = await service.list_lots(session, product_id=product_id, limit=limit, offset=offset)
    return [await _lot_to_read(session, lot) for lot in lots]


@router.get("/lots/{lot_id}", response_model=LotRead, dependencies=[_require_read])
async def get_lot(lot_id: int, session: SessionDep) -> LotRead:
    return await _lot_to_read(session, await service.get_lot(session, lot_id))


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
        LotBalanceRead(lot=await _lot_to_read(session, b.lot), quantity=b.quantity)
        for b in balances
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
