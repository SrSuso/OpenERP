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


class TicketTemplateRevise(BaseModel):
    """Every field is required — a revision is a whole new version, not a
    partial patch of the one it retires (see the model's docstring)."""

    width_mm: Literal[58, 80]
    header_text: str = Field(default="", max_length=2000)
    footer_text: str = Field(default="", max_length=2000)
    tax_display: TicketTaxDisplay = TicketTaxDisplay.BREAKDOWN
    show_line_discounts: bool = False


class TicketTemplateRead(BaseModel):
    id: int
    name: str
    version: int
    width_mm: int
    header_text: str
    footer_text: str
    tax_display: TicketTaxDisplay
    show_line_discounts: bool
    is_active: bool


class TicketRead(BaseModel):
    id: int
    sale_id: int
    template_id: int
    width_mm: int
    rendered_text: str
    created_at: datetime
