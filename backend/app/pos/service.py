"""Registration and validation of physical/logical POS terminals."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.inventory.models import Warehouse
from app.pos.models import PosTerminal
from app.pos.schemas import PosTerminalCreate, PosTerminalUpdate


async def get_terminal(
    session: AsyncSession, terminal_id: int, *, for_update: bool = False
) -> PosTerminal:
    statement = (
        select(PosTerminal)
        .where(PosTerminal.id == terminal_id)
        .options(selectinload(PosTerminal.warehouse))
        .execution_options(populate_existing=True)
    )
    if for_update:
        statement = statement.with_for_update()
    terminal = (await session.execute(statement)).scalar_one_or_none()
    if terminal is None:
        raise NotFoundError(f"POS terminal {terminal_id} not found.")
    return terminal


async def require_active_terminal(
    session: AsyncSession, terminal_id: int, *, for_update: bool = False
) -> PosTerminal:
    terminal = await get_terminal(session, terminal_id, for_update=for_update)
    if not terminal.is_active:
        raise ConflictError(f"POS terminal {terminal_id} is inactive.")
    return terminal


async def list_terminals(session: AsyncSession, *, active_only: bool = True) -> list[PosTerminal]:
    statement = (
        select(PosTerminal)
        .options(selectinload(PosTerminal.warehouse))
        .order_by(PosTerminal.warehouse_id, PosTerminal.name, PosTerminal.id)
    )
    if active_only:
        statement = statement.where(PosTerminal.is_active.is_(True))
    return list((await session.execute(statement)).scalars())


async def create_terminal(session: AsyncSession, payload: PosTerminalCreate) -> PosTerminal:
    warehouse = await session.get(Warehouse, payload.warehouse_id)
    if warehouse is None:
        raise ValidationError(f"Warehouse {payload.warehouse_id} does not exist.")
    if not warehouse.is_active:
        raise ValidationError(f"Warehouse {payload.warehouse_id} is inactive.")
    duplicate = await session.scalar(
        select(PosTerminal.id).where(
            PosTerminal.warehouse_id == payload.warehouse_id,
            PosTerminal.name == payload.name,
        )
    )
    if duplicate is not None:
        raise ConflictError(
            f"A POS terminal named {payload.name!r} already exists in this warehouse."
        )

    terminal = PosTerminal(name=payload.name, warehouse_id=payload.warehouse_id)
    session.add(terminal)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="pos_terminal",
        entity_id=terminal.id,
        after={
            "name": terminal.name,
            "warehouse_id": terminal.warehouse_id,
            "is_active": terminal.is_active,
            "show_product_search": terminal.show_product_search,
        },
    )
    return await get_terminal(session, terminal.id)


async def update_terminal(
    session: AsyncSession, terminal_id: int, payload: PosTerminalUpdate
) -> PosTerminal:
    terminal = await get_terminal(session, terminal_id, for_update=True)
    before = {
        "name": terminal.name,
        "is_active": terminal.is_active,
        "show_product_search": terminal.show_product_search,
    }
    if payload.name is not None and payload.name != terminal.name:
        duplicate = await session.scalar(
            select(PosTerminal.id).where(
                PosTerminal.warehouse_id == terminal.warehouse_id,
                PosTerminal.name == payload.name,
                PosTerminal.id != terminal.id,
            )
        )
        if duplicate is not None:
            raise ConflictError(
                f"A POS terminal named {payload.name!r} already exists in this warehouse."
            )
        terminal.name = payload.name
    if payload.is_active is not None:
        if payload.is_active and not terminal.warehouse.is_active:
            raise ValidationError(
                f"POS terminal {terminal_id} cannot be activated in an inactive warehouse."
            )
        terminal.is_active = payload.is_active
    if payload.show_product_search is not None:
        terminal.show_product_search = payload.show_product_search

    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type="pos_terminal",
        entity_id=terminal.id,
        before=before,
        after={
            "name": terminal.name,
            "is_active": terminal.is_active,
            "show_product_search": terminal.show_product_search,
        },
    )
    return await get_terminal(session, terminal.id)
