"""Pydantic schemas for returns."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class ReturnLineCreate(BaseModel):
    sale_line_id: int
    #: In the same package the line was originally sold in — a return
    #: never re-picks a different presentation.
    quantity_packages: Decimal = Field(gt=0)
    #: Independent per rule 9 — at least one must be true.
    economic: bool = True
    physical: bool = True
    #: Required only when ``physical`` and the product tracks lots. Reuses
    #: an existing lot with this number for the product if one exists,
    #: otherwise creates it (same convenience as a goods receipt, phase 9).
    lot_number: str | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def _at_least_one_effect(self) -> ReturnLineCreate:
        if not self.economic and not self.physical:
            raise ValueError("A return line must be economic, physical, or both.")
        return self


class ReturnCreate(BaseModel):
    notes: str = Field(default="", max_length=2000)
    lines: list[ReturnLineCreate] = Field(min_length=1)


class ReturnLineRead(BaseModel):
    id: int
    sale_line_id: int
    product_id: int
    product_sku: str
    product_name: str
    package_id: int
    package_name: str
    quantity_packages: Decimal
    quantity_base: Decimal
    is_economic: bool
    is_physical: bool
    refund_amount: Decimal
    lot_id: int | None
    lot_number: str | None
    stock_movement_id: int | None


class ReturnRead(BaseModel):
    id: int
    sale_id: int
    notes: str
    processed_by_user_id: int | None
    created_at: datetime
    lines: list[ReturnLineRead]
    #: Computed, not stored — the sum of each line's own snapshot.
    total_refund: Decimal
