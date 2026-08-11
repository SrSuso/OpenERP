"""Inventory ledger endpoints. Reading needs ``inventory.read``; recording
adjustments/transfers, managing warehouses and rebuilding the projection
need ``inventory.manage``."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import SessionDep
from app.catalog.models import Product
from app.catalog.service import get_product
from app.inventory import service
from app.inventory.models import Location, StockBalance, StockMovement, Warehouse
from app.inventory.schemas import (
    AdjustmentCreate,
    LocationCreate,
    LocationRead,
    StockBalanceRead,
    StockMovementRead,
    TransferCreate,
    TransferResult,
    WarehouseCreate,
    WarehouseRead,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import INVENTORY_MANAGE, INVENTORY_READ

router = APIRouter(tags=["inventory"])

_require_read = Depends(require_permission(INVENTORY_READ))
_require_manage = Depends(require_permission(INVENTORY_MANAGE))


def _warehouse_to_read(warehouse: Warehouse) -> WarehouseRead:
    return WarehouseRead(id=warehouse.id, name=warehouse.name, is_active=warehouse.is_active)


def _location_to_read(location: Location) -> LocationRead:
    return LocationRead(
        id=location.id,
        warehouse_id=location.warehouse_id,
        name=location.name,
        is_active=location.is_active,
    )


async def _movement_to_read(session: AsyncSession, movement: StockMovement) -> StockMovementRead:
    product = await get_product(session, movement.product_id)
    return StockMovementRead(
        id=movement.id,
        product_id=movement.product_id,
        product_sku=product.sku,
        warehouse_id=movement.warehouse_id,
        location_id=movement.location_id,
        lot_id=movement.lot_id,
        quantity=movement.quantity,
        movement_type=movement.movement_type,
        reference_type=movement.reference_type,
        reference_id=movement.reference_id,
        unit_cost=movement.unit_cost,
        user_id=movement.user_id,
        created_at=movement.created_at,
    )


def _balance_to_read(balance: StockBalance, product: Product) -> StockBalanceRead:
    return StockBalanceRead(
        product_id=balance.product_id,
        product_sku=product.sku,
        product_name=product.name,
        warehouse_id=balance.warehouse_id,
        location_id=balance.location_id,
        lot_id=balance.lot_id,
        quantity=balance.quantity,
    )


@router.get("/warehouses", response_model=list[WarehouseRead], dependencies=[_require_read])
async def list_warehouses(session: SessionDep, active_only: bool = True) -> list[WarehouseRead]:
    warehouses = await service.list_warehouses(session, active_only=active_only)
    return [_warehouse_to_read(w) for w in warehouses]


@router.post(
    "/warehouses", response_model=WarehouseRead, status_code=201, dependencies=[_require_manage]
)
async def create_warehouse(payload: WarehouseCreate, session: SessionDep) -> WarehouseRead:
    return _warehouse_to_read(await service.create_warehouse(session, payload.name))


@router.get(
    "/warehouses/{warehouse_id}/locations",
    response_model=list[LocationRead],
    dependencies=[_require_read],
)
async def list_locations(
    warehouse_id: int, session: SessionDep, active_only: bool = True
) -> list[LocationRead]:
    locations = await service.list_locations(session, warehouse_id, active_only=active_only)
    return [_location_to_read(location) for location in locations]


@router.post(
    "/warehouses/{warehouse_id}/locations",
    response_model=LocationRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_location(
    warehouse_id: int, payload: LocationCreate, session: SessionDep
) -> LocationRead:
    return _location_to_read(await service.create_location(session, warehouse_id, payload.name))


@router.get(
    "/stock-movements", response_model=list[StockMovementRead], dependencies=[_require_read]
)
async def list_movements(
    session: SessionDep,
    product_id: Annotated[int | None, Query()] = None,
    warehouse_id: Annotated[int | None, Query()] = None,
    location_id: Annotated[int | None, Query()] = None,
    lot_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[StockMovementRead]:
    movements = await service.list_movements(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        location_id=location_id,
        lot_id=lot_id,
        limit=limit,
        offset=offset,
    )
    return [await _movement_to_read(session, m) for m in movements]


@router.get("/stock-balance", response_model=list[StockBalanceRead], dependencies=[_require_read])
async def list_balances(
    session: SessionDep,
    product_id: Annotated[int | None, Query()] = None,
    warehouse_id: Annotated[int | None, Query()] = None,
    lot_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[StockBalanceRead]:
    balances = await service.list_balances(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        lot_id=lot_id,
        limit=limit,
        offset=offset,
    )
    results = []
    for balance in balances:
        product = await get_product(session, balance.product_id)
        results.append(_balance_to_read(balance, product))
    return results


@router.post(
    "/stock-movements/adjustments",
    response_model=StockMovementRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def record_adjustment(payload: AdjustmentCreate, session: SessionDep) -> StockMovementRead:
    movement = await service.record_adjustment(session, payload)
    return await _movement_to_read(session, movement)


@router.post(
    "/stock-movements/transfers",
    response_model=TransferResult,
    status_code=201,
    dependencies=[_require_manage],
)
async def record_transfer(payload: TransferCreate, session: SessionDep) -> TransferResult:
    out_movement, in_movement = await service.record_transfer(session, payload)
    return TransferResult(
        out_movement=await _movement_to_read(session, out_movement),
        in_movement=await _movement_to_read(session, in_movement),
    )


@router.post("/stock-balance/rebuild", dependencies=[_require_manage])
async def rebuild_stock_balance(session: SessionDep) -> dict[str, int]:
    rows = await service.rebuild_stock_balance(session)
    return {"rows": rows}
