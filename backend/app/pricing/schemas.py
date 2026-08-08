"""Pydantic schemas for pricing."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class FormulaPreviewRequest(BaseModel):
    """Try a formula against sample inputs without touching a real product —
    for building/testing a formula before saving it."""

    formula: str = Field(min_length=1, max_length=500)
    cost: Decimal = Field(default=Decimal(0), ge=0)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0)
    surcharge_rate: Decimal = Field(default=Decimal(0), ge=0)
    margin_rate: Decimal = Field(default=Decimal(0), ge=0)


class FormulaPreviewResponse(BaseModel):
    result: Decimal


class SetPricingInputsRequest(BaseModel):
    """Updates whichever pricing inputs are given; if the product currently
    has a formula, its price is recomputed from the new inputs."""

    cost: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=None, ge=0)
    surcharge_rate: Decimal | None = Field(default=None, ge=0)
    margin_rate: Decimal | None = Field(default=None, ge=0)


class SetFormulaRequest(BaseModel):
    price_formula: str = Field(min_length=1, max_length=500)


class SetManualPriceRequest(BaseModel):
    list_price: Decimal = Field(ge=0)


class PriceHistoryEntryRead(BaseModel):
    id: int
    product_id: int
    cost: Decimal
    tax_rate: Decimal
    surcharge_rate: Decimal
    margin_rate: Decimal
    price_formula: str | None
    list_price: Decimal
    created_at: datetime
