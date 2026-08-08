"""ORM -> response-schema conversion for ``app.tickets.router``."""

from __future__ import annotations

from app.tickets.models import Ticket, TicketTemplate
from app.tickets.schemas import TicketRead, TicketTemplateRead


def template_to_read(template: TicketTemplate) -> TicketTemplateRead:
    return TicketTemplateRead(
        id=template.id,
        name=template.name,
        version=template.version,
        width_mm=template.width_mm,
        header_text=template.header_text,
        footer_text=template.footer_text,
        show_tax_breakdown=template.show_tax_breakdown,
        is_active=template.is_active,
    )


def ticket_to_read(ticket: Ticket) -> TicketRead:
    return TicketRead(
        id=ticket.id,
        sale_id=ticket.sale_id,
        template_id=ticket.template_id,
        width_mm=ticket.width_mm,
        rendered_text=ticket.rendered_text,
        created_at=ticket.created_at,
    )
