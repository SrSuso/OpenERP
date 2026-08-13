"""POS terminal selection and minimal administrative management."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep
from app.pos import service
from app.pos.models import PosTerminal
from app.pos.schemas import PosTerminalCreate, PosTerminalRead, PosTerminalUpdate
from app.rbac.dependencies import require_permission
from app.rbac.permissions import INVENTORY_MANAGE, SALE_READ

router = APIRouter(tags=["pos-terminals"])

_require_sale_read = Depends(require_permission(SALE_READ))
_require_manage = Depends(require_permission(INVENTORY_MANAGE))


def _to_read(terminal: PosTerminal) -> PosTerminalRead:
    return PosTerminalRead(
        id=terminal.id,
        name=terminal.name,
        warehouse_id=terminal.warehouse_id,
        warehouse_name=terminal.warehouse.name,
        is_active=terminal.is_active,
        created_at=terminal.created_at,
    )


@router.get(
    "/pos-terminals", response_model=list[PosTerminalRead], dependencies=[_require_sale_read]
)
async def list_pos_terminals(
    session: SessionDep, active_only: bool = True
) -> list[PosTerminalRead]:
    return [
        _to_read(terminal)
        for terminal in await service.list_terminals(session, active_only=active_only)
    ]


@router.post(
    "/pos-terminals",
    response_model=PosTerminalRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_pos_terminal(payload: PosTerminalCreate, session: SessionDep) -> PosTerminalRead:
    return _to_read(await service.create_terminal(session, payload))


@router.patch(
    "/pos-terminals/{terminal_id}",
    response_model=PosTerminalRead,
    dependencies=[_require_manage],
)
async def update_pos_terminal(
    terminal_id: int, payload: PosTerminalUpdate, session: SessionDep
) -> PosTerminalRead:
    return _to_read(await service.update_terminal(session, terminal_id, payload))
