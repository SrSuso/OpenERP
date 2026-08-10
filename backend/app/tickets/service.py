"""Ticket template management and per-sale ticket generation.

Only one template is active store-wide at a time — the till prints one
receipt layout — but a shop can keep as many as it likes and switch
between them with ``activate_template``.

``revise_template`` is the only way to change what a *new* ticket looks
like; it never mutates a past version (see ``app.tickets.models`` for
why), and revising one that is not in use leaves it that way, so an
alternative can be corrected without changing what the till prints.
"""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.core.errors import NotFoundError, ValidationError
from app.pricing import service as pricing_service
from app.sales.models import Sale, SaleLine, SaleStatus
from app.settings import store as settings_store
from app.tickets.models import Ticket, TicketTemplate
from app.tickets.render import render_ticket
from app.tickets.schemas import TicketTemplateCreate, TicketTemplateRevise
from app.users.models import User

_SALE_OPTIONS = (
    selectinload(Sale.lines).selectinload(SaleLine.product),
    selectinload(Sale.payments),
)


async def list_templates(session: AsyncSession) -> list[TicketTemplate]:
    stmt = select(TicketTemplate).order_by(TicketTemplate.name, TicketTemplate.version.desc())
    return list((await session.execute(stmt)).scalars())


async def get_active_template(session: AsyncSession) -> TicketTemplate:
    stmt = select(TicketTemplate).where(TicketTemplate.is_active.is_(True))
    template = (await session.execute(stmt)).scalar_one_or_none()
    if template is None:
        raise ValidationError(
            "No active ticket template configured — create one with POST /ticket-templates first."
        )
    return template


async def _deactivate_all(session: AsyncSession) -> None:
    await session.execute(update(TicketTemplate).values(is_active=False))


async def create_template(session: AsyncSession, payload: TicketTemplateCreate) -> TicketTemplate:
    await _deactivate_all(session)
    template = TicketTemplate(
        name=payload.name,
        version=1,
        width_mm=payload.width_mm,
        header_text=payload.header_text,
        footer_text=payload.footer_text,
        tax_display=payload.tax_display,
        show_line_discounts=payload.show_line_discounts,
        is_active=True,
    )
    session.add(template)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="ticket_template",
        entity_id=template.id,
        after={"name": template.name, "version": template.version, "width_mm": template.width_mm},
    )
    return template


async def get_template(session: AsyncSession, template_id: int) -> TicketTemplate:
    template = await session.get(TicketTemplate, template_id)
    if template is None:
        raise NotFoundError(f"Ticket template {template_id} not found.")
    return template


async def revise_template(
    session: AsyncSession, template_id: int, payload: TicketTemplateRevise
) -> TicketTemplate:
    current = await get_template(session, template_id)
    was_active = current.is_active
    current.is_active = False
    await session.flush()

    revised = TicketTemplate(
        name=current.name,
        version=current.version + 1,
        width_mm=payload.width_mm,
        header_text=payload.header_text,
        footer_text=payload.footer_text,
        tax_display=payload.tax_display,
        show_line_discounts=payload.show_line_discounts,
        # Editar una plantilla que no estaba en uso no cambia con cuál se
        # imprime: se corrige una alternativa guardada sin tocar la caja.
        # Para cambiar de plantilla está `activate_template`.
        is_active=was_active,
    )
    session.add(revised)
    await session.flush()
    await audit.record(
        session,
        action="revised",
        entity_type="ticket_template",
        entity_id=revised.id,
        before={"template_id": current.id, "version": current.version},
        after={"template_id": revised.id, "version": revised.version},
    )
    return revised


async def activate_template(session: AsyncSession, template_id: int) -> TicketTemplate:
    """Pone en uso una plantilla concreta. Sigue habiendo exactamente una
    activa (ver el docstring del módulo): activar una retira la anterior,
    que se queda guardada para poder volver a ella."""
    template = await get_template(session, template_id)
    if template.is_active:
        return template

    await _deactivate_all(session)
    template.is_active = True
    await session.flush()
    await audit.record(
        session,
        action="activated",
        entity_type="ticket_template",
        entity_id=template_id,
        after={"name": template.name, "version": template.version},
    )
    return template


async def get_ticket(session: AsyncSession, sale_id: int) -> Ticket:
    stmt = select(Ticket).where(Ticket.sale_id == sale_id)
    ticket = (await session.execute(stmt)).scalar_one_or_none()
    if ticket is None:
        raise NotFoundError(f"No ticket generated yet for sale {sale_id}.")
    return ticket


async def generate_ticket(session: AsyncSession, sale_id: int) -> Ticket:
    """Idempotent: a sale gets exactly one ticket, ever. A second call
    returns the same row untouched — including its already-frozen
    ``rendered_text`` — rather than re-rendering against whatever template
    happens to be active now."""
    existing = (
        await session.execute(select(Ticket).where(Ticket.sale_id == sale_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    sale_stmt = select(Sale).where(Sale.id == sale_id).options(*_SALE_OPTIONS)
    sale = (await session.execute(sale_stmt)).scalar_one_or_none()
    if sale is None:
        raise ValidationError(f"Sale {sale_id} does not exist.")
    if sale.status != SaleStatus.COMPLETED:
        raise ValidationError(
            f"Only a completed sale has a ticket to print (this one is {sale.status})."
        )

    template = await get_active_template(session)
    prices_include_tax = (await pricing_service.get_settings(session)).prices_include_tax
    settings = await settings_store.get_values(session)
    cashier_name: str | None = None
    if settings["ticket.show_cashier"] and sale.cashier_user_id is not None:
        cashier = await session.get(User, sale.cashier_user_id)
        cashier_name = cashier.full_name if cashier is not None else None
    rendered_text = render_ticket(
        sale,
        template,
        prices_include_tax=prices_include_tax,
        settings=settings,
        cashier_name=cashier_name,
    )

    ticket = Ticket(
        sale_id=sale_id,
        template_id=template.id,
        width_mm=template.width_mm,
        rendered_text=rendered_text,
    )
    session.add(ticket)
    await session.flush()
    await audit.record(
        session,
        action="generated",
        entity_type="ticket",
        entity_id=ticket.id,
        after={"sale_id": sale_id, "template_id": template.id},
    )
    return ticket
