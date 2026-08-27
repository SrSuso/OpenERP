"""Pydantic schemas for ticket templates and tickets."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from app.tickets.layout import TicketLayoutError, validate_layout_template
from app.tickets.models import (
    TicketFontFamily,
    TicketFontWeight,
    TicketLayoutMode,
    TicketTaxDisplay,
)


class TicketTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    printable_width_mm: int = Field(default=72, ge=25, le=80)
    margin_left_mm: int = Field(default=0, ge=0, le=55)
    margin_right_mm: int = Field(default=0, ge=0, le=55)
    font_family: TicketFontFamily = TicketFontFamily.COURIER_NEW
    font_size_px: int = Field(default=9, ge=6, le=16)
    line_height_px: int = Field(default=12, ge=8, le=24)
    font_weight: TicketFontWeight = TicketFontWeight.NORMAL
    margin_top_mm: int = Field(default=0, ge=0, le=20)
    margin_bottom_mm: int = Field(default=0, ge=0, le=20)
    layout_template: str = Field(default="", max_length=8000)
    layout_mode: TicketLayoutMode = TicketLayoutMode.STANDARD
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

    @field_validator("layout_template")
    @classmethod
    def layout_template_is_safe(cls, value: str) -> str:
        try:
            validate_layout_template(value)
        except TicketLayoutError as exc:
            raise ValueError(str(exc)) from exc
        return value

    @model_validator(mode="after")
    def print_area_and_editor_mode_are_coherent(self) -> TicketTemplateCreate:
        occupied = self.margin_left_mm + self.printable_width_mm + self.margin_right_mm
        if occupied > 80:
            raise ValueError(
                "El margen izquierdo, el ancho imprimible y el margen derecho "
                "no pueden superar juntos los 80 mm del papel."
            )
        if self.layout_mode == TicketLayoutMode.CUSTOM and not self.layout_template.strip():
            raise ValueError("El editor con variables necesita un diseño de ticket.")
        return self


class TicketTemplateUpdate(TicketTemplateCreate):
    """The saved template is updated directly; it does not create a version."""


class TicketTemplateRead(BaseModel):
    id: int
    name: str
    printable_width_mm: int
    margin_left_mm: int
    margin_right_mm: int
    font_family: TicketFontFamily
    font_size_px: int
    line_height_px: int
    font_weight: TicketFontWeight
    margin_top_mm: int
    margin_bottom_mm: int
    layout_template: str
    layout_mode: TicketLayoutMode
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


class TicketPrintProfileRead(BaseModel):
    """Safe layout fields needed by a POS document at print time.

    Cashiers may read this small profile to print a Z with the same physical
    layout as a sale ticket. It deliberately excludes template-management
    fields and store/editor content.
    """

    printable_width_mm: int
    margin_left_mm: int
    margin_right_mm: int
    font_family: TicketFontFamily
    font_size_px: int
    line_height_px: int
    font_weight: TicketFontWeight
    margin_top_mm: int
    margin_bottom_mm: int


class TicketRead(BaseModel):
    id: int
    sale_id: int
    template_id: int | None
    printable_width_mm: int
    margin_left_mm: int
    margin_right_mm: int
    font_family: TicketFontFamily
    font_size_px: int
    line_height_px: int
    font_weight: TicketFontWeight
    margin_top_mm: int
    margin_bottom_mm: int
    rendered_text: str
    created_at: datetime
