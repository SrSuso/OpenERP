"""ORM -> response-schema conversion for ``app.tickets.router``."""

from __future__ import annotations

from app.tickets.models import (
    Ticket,
    TicketFontFamily,
    TicketFontWeight,
    TicketLayoutMode,
    TicketTaxDisplay,
    TicketTemplate,
)
from app.tickets.schemas import TicketPrintProfileRead, TicketRead, TicketTemplateRead


def template_to_read(template: TicketTemplate) -> TicketTemplateRead:
    return TicketTemplateRead(
        id=template.id,
        name=template.name,
        printable_width_mm=template.printable_width_mm,
        margin_left_mm=template.margin_left_mm,
        margin_right_mm=template.margin_right_mm,
        font_family=TicketFontFamily(template.font_family),
        font_size_px=template.font_size_px,
        line_height_px=template.line_height_px,
        font_weight=TicketFontWeight(template.font_weight),
        margin_top_mm=template.margin_top_mm,
        margin_bottom_mm=template.margin_bottom_mm,
        layout_template=template.layout_template,
        layout_mode=TicketLayoutMode(template.layout_mode),
        header_text=template.header_text,
        footer_text=template.footer_text,
        tax_display=TicketTaxDisplay(template.tax_display),
        show_line_discounts=template.show_line_discounts,
        store_name=template.store_name,
        store_tax_id=template.store_tax_id,
        store_address=template.store_address,
        store_phone=template.store_phone,
        sale_number_prefix=template.sale_number_prefix,
        date_format=template.date_format,
        show_unit_price=template.show_unit_price,
        show_cashier=template.show_cashier,
        label_total=template.label_total,
        label_change=template.label_change,
        label_cash=template.label_cash,
        label_card=template.label_card,
        label_other=template.label_other,
        label_discount=template.label_discount,
        tax_note=template.tax_note,
        is_active=template.is_active,
    )


def template_to_print_profile(template: TicketTemplate) -> TicketPrintProfileRead:
    return TicketPrintProfileRead(
        printable_width_mm=template.printable_width_mm,
        margin_left_mm=template.margin_left_mm,
        margin_right_mm=template.margin_right_mm,
        font_family=TicketFontFamily(template.font_family),
        font_size_px=template.font_size_px,
        line_height_px=template.line_height_px,
        font_weight=TicketFontWeight(template.font_weight),
        margin_top_mm=template.margin_top_mm,
        margin_bottom_mm=template.margin_bottom_mm,
    )


def ticket_to_read(ticket: Ticket) -> TicketRead:
    return TicketRead(
        id=ticket.id,
        sale_id=ticket.sale_id,
        template_id=ticket.template_id,
        printable_width_mm=ticket.printable_width_mm,
        margin_left_mm=ticket.margin_left_mm,
        margin_right_mm=ticket.margin_right_mm,
        font_family=TicketFontFamily(ticket.font_family),
        font_size_px=ticket.font_size_px,
        line_height_px=ticket.line_height_px,
        font_weight=TicketFontWeight(ticket.font_weight),
        margin_top_mm=ticket.margin_top_mm,
        margin_bottom_mm=ticket.margin_bottom_mm,
        rendered_text=ticket.rendered_text,
        created_at=ticket.created_at,
    )
