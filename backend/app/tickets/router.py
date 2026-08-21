"""Ticket endpoints.

Managing templates needs ``ticket.manage`` (``ADMIN`` by default) — back-
office configuration, no POS use case for it. Generating/reading a sale's
ticket reuses ``sale.read`` (``CASHIER`` already has it since phase 11) —
printing a receipt is just rendering a sale the cashier can already see,
not a new capability of its own.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep
from app.rbac.dependencies import require_permission
from app.rbac.permissions import SALE_READ, TICKET_MANAGE
from app.tickets import service
from app.tickets.presenters import template_to_read as _template_to_read
from app.tickets.presenters import ticket_to_read as _ticket_to_read
from app.tickets.schemas import (
    TicketRead,
    TicketTemplateCreate,
    TicketTemplateRead,
    TicketTemplateRevise,
)

router = APIRouter(tags=["tickets"])

_require_manage = Depends(require_permission(TICKET_MANAGE))
_require_sale_read = Depends(require_permission(SALE_READ))


@router.get(
    "/ticket-templates", response_model=list[TicketTemplateRead], dependencies=[_require_manage]
)
async def list_templates(session: SessionDep) -> list[TicketTemplateRead]:
    return [_template_to_read(t) for t in await service.list_templates(session)]


@router.post(
    "/ticket-templates",
    response_model=TicketTemplateRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_template(payload: TicketTemplateCreate, session: SessionDep) -> TicketTemplateRead:
    return _template_to_read(await service.create_template(session, payload))


@router.get(
    "/ticket-templates/active",
    response_model=TicketTemplateRead,
    dependencies=[_require_manage],
)
async def get_active_template(session: SessionDep) -> TicketTemplateRead:
    return _template_to_read(await service.get_active_template(session))


@router.post(
    "/ticket-templates/{template_id}/revise",
    response_model=TicketTemplateRead,
    dependencies=[_require_manage],
)
async def revise_template(
    template_id: int, payload: TicketTemplateRevise, session: SessionDep
) -> TicketTemplateRead:
    return _template_to_read(await service.revise_template(session, template_id, payload))


@router.post(
    "/ticket-templates/{template_id}/activate",
    response_model=TicketTemplateRead,
    dependencies=[_require_manage],
)
async def activate_template(template_id: int, session: SessionDep) -> TicketTemplateRead:
    return _template_to_read(await service.activate_template(session, template_id))


@router.delete(
    "/ticket-templates/{template_id}",
    status_code=204,
    dependencies=[_require_manage],
)
async def delete_template(template_id: int, session: SessionDep) -> None:
    await service.delete_template(session, template_id)


@router.post(
    "/sales/{sale_id}/tickets",
    response_model=TicketRead,
    status_code=201,
    dependencies=[_require_sale_read],
)
async def generate_ticket(sale_id: int, session: SessionDep) -> TicketRead:
    return _ticket_to_read(await service.generate_ticket(session, sale_id))


@router.get("/sales/{sale_id}/ticket", response_model=TicketRead, dependencies=[_require_sale_read])
async def get_ticket(sale_id: int, session: SessionDep) -> TicketRead:
    return _ticket_to_read(await service.get_ticket(session, sale_id))
