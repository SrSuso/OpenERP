"""Pydantic schemas for returns."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.returns.models import RefundStatus
from app.sales.models import PaymentMethod


class ReturnLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sale_line_id: int
    #: Independent quantities, both in the presentation originally sold.
    refund_quantity_packages: Decimal = Field(default=Decimal(0), ge=0)
    stock_return_quantity_packages: Decimal = Field(default=Decimal(0), ge=0)
    #: Required only when physical quantity is positive and the product tracks lots. Reuses
    #: an existing lot with this number for the product if one exists,
    #: otherwise creates it (same convenience as a goods receipt, phase 9).
    lot_number: str | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def _at_least_one_effect(self) -> ReturnLineCreate:
        if self.refund_quantity_packages == 0 and self.stock_return_quantity_packages == 0:
            raise ValueError("Una línea de devolución necesita una cantidad económica o física.")
        return self


class ReturnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notes: str = Field(default="", max_length=2000)
    lines: list[ReturnLineCreate] = Field(min_length=1)
    #: Required exactly when at least one line has an economic quantity.
    refund_method: PaymentMethod | None = None

    @model_validator(mode="after")
    def _refund_method_matches_effect(self) -> ReturnCreate:
        has_economic_effect = any(line.refund_quantity_packages > 0 for line in self.lines)
        if has_economic_effect and self.refund_method is None:
            raise ValueError("Debe indicar el medio del reembolso económico.")
        if not has_economic_effect and self.refund_method is not None:
            raise ValueError("No puede indicar un medio de reembolso si no se devuelve dinero.")
        return self


class ReturnLineRead(BaseModel):
    id: int
    sale_line_id: int
    product_id: int
    product_sku: str
    product_name: str
    package_id: int
    package_name: str
    refund_quantity_packages: Decimal
    refund_quantity_base: Decimal
    stock_return_quantity_packages: Decimal
    stock_return_quantity_base: Decimal
    refund_amount: Decimal
    lot_id: int | None
    lot_number: str | None
    stock_movement_id: int | None


class RefundRead(BaseModel):
    id: int
    return_id: int
    amount: Decimal
    method: PaymentMethod | None
    status: RefundStatus
    processed_by_user_id: int | None
    created_at: datetime
    completed_at: datetime


class ReturnRead(BaseModel):
    id: int
    sale_id: int
    notes: str
    processed_by_user_id: int | None
    created_at: datetime
    lines: list[ReturnLineRead]
    refund: RefundRead | None
    #: Compatibility/convenience projection of ``refund.amount``; zero when
    #: this is a physical-only return and no Refund exists.
    total_refund: Decimal
