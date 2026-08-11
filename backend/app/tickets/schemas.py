"""Pydantic schemas for ticket templates and tickets."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.tickets.models import TicketTaxDisplay


class TicketTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    width_mm: Literal[58, 80]
    header_text: str = Field(default="", max_length=2000)
    footer_text: str = Field(default="", max_length=2000)
    tax_display: TicketTaxDisplay = TicketTaxDisplay.BREAKDOWN
    show_line_discounts: bool = False
    #: Los datos de la tienda tal y como se imprimen, arriba del todo. Aquí
    #: y no en Configuración: el ticket se edita en un solo sitio (ver
    #: `app.tickets.models.TicketTemplate`).
    store_name: str = Field(default="", max_length=500)
    store_tax_id: str = Field(default="", max_length=500)
    store_address: str = Field(default="", max_length=1000)
    store_phone: str = Field(default="", max_length=200)
    sale_number_prefix: str = Field(default="Venta #", max_length=50)
    #: Patrón de `strftime`.
    date_format: str = Field(default="%Y-%m-%d %H:%M", max_length=50)
    show_unit_price: bool = True
    show_cashier: bool = False
    label_total: str = Field(default="TOTAL", max_length=50)
    label_change: str = Field(default="Cambio", max_length=50)
    label_cash: str = Field(default="Efectivo", max_length=50)
    label_card: str = Field(default="Tarjeta", max_length=50)
    label_other: str = Field(default="Otros", max_length=50)
    label_discount: str = Field(default="Dto.", max_length=50)
    tax_note: str = Field(default="IVA incluido", max_length=200)


class TicketTemplateRevise(BaseModel):
    """Every field is required — a revision is a whole new version, not a
    partial patch of the one it retires (see the model's docstring)."""

    width_mm: Literal[58, 80]
    header_text: str = Field(default="", max_length=2000)
    footer_text: str = Field(default="", max_length=2000)
    tax_display: TicketTaxDisplay = TicketTaxDisplay.BREAKDOWN
    show_line_discounts: bool = False
    #: Los datos de la tienda tal y como se imprimen, arriba del todo. Aquí
    #: y no en Configuración: el ticket se edita en un solo sitio (ver
    #: `app.tickets.models.TicketTemplate`).
    store_name: str = Field(default="", max_length=500)
    store_tax_id: str = Field(default="", max_length=500)
    store_address: str = Field(default="", max_length=1000)
    store_phone: str = Field(default="", max_length=200)
    sale_number_prefix: str = Field(default="Venta #", max_length=50)
    #: Patrón de `strftime`.
    date_format: str = Field(default="%Y-%m-%d %H:%M", max_length=50)
    show_unit_price: bool = True
    show_cashier: bool = False
    label_total: str = Field(default="TOTAL", max_length=50)
    label_change: str = Field(default="Cambio", max_length=50)
    label_cash: str = Field(default="Efectivo", max_length=50)
    label_card: str = Field(default="Tarjeta", max_length=50)
    label_other: str = Field(default="Otros", max_length=50)
    label_discount: str = Field(default="Dto.", max_length=50)
    tax_note: str = Field(default="IVA incluido", max_length=200)


class TicketTemplateRead(BaseModel):
    id: int
    name: str
    version: int
    width_mm: int
    header_text: str
    footer_text: str
    tax_display: TicketTaxDisplay
    show_line_discounts: bool
    store_name: str
    store_tax_id: str
    store_address: str
    store_phone: str
    sale_number_prefix: str
    date_format: str
    show_unit_price: bool
    show_cashier: bool
    label_total: str
    label_change: str
    label_cash: str
    label_card: str
    label_other: str
    label_discount: str
    tax_note: str
    is_active: bool


class TicketRead(BaseModel):
    id: int
    sale_id: int
    template_id: int
    width_mm: int
    rendered_text: str
    created_at: datetime
