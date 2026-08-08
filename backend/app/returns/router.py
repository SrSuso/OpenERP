"""Return endpoints. Unlike sales, both reading and processing a return
need ``return.manage``/``return.read`` restricted to ``ADMIN``/``MANAGER``
— reversing money and stock on an already-completed sale is a supervisory
action here, not a cashier's routine job (contrast with
``app.sales.router``, where ``CASHIER`` holds both)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import SessionDep
from app.rbac.dependencies import require_permission
from app.rbac.permissions import RETURN_MANAGE, RETURN_READ
from app.returns import service
from app.returns.presenters import return_to_read as _to_read
from app.returns.schemas import ReturnCreate, ReturnRead

router = APIRouter(tags=["returns"])

_require_read = Depends(require_permission(RETURN_READ))
_require_manage = Depends(require_permission(RETURN_MANAGE))


@router.post(
    "/sales/{sale_id}/returns",
    response_model=ReturnRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_return(sale_id: int, payload: ReturnCreate, session: SessionDep) -> ReturnRead:
    return _to_read(await service.create_return(session, sale_id, payload))


@router.get(
    "/sales/{sale_id}/returns", response_model=list[ReturnRead], dependencies=[_require_read]
)
async def list_sale_returns(sale_id: int, session: SessionDep) -> list[ReturnRead]:
    return [_to_read(r) for r in await service.list_returns(session, sale_id=sale_id)]


@router.get("/returns", response_model=list[ReturnRead], dependencies=[_require_read])
async def list_returns(
    session: SessionDep,
    sale_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ReturnRead]:
    returns = await service.list_returns(session, sale_id=sale_id, limit=limit, offset=offset)
    return [_to_read(r) for r in returns]


@router.get("/returns/{return_id}", response_model=ReturnRead, dependencies=[_require_read])
async def get_return(return_id: int, session: SessionDep) -> ReturnRead:
    return _to_read(await service.get_return(session, return_id))
