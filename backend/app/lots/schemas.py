"""Pydantic schemas for lots and FEFO allocation."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class LotCreate(BaseModel):
    product_id: int
    lot_number: str = Field(min_length=1, max_length=100)
    manufacturing_date: date | None = None
    expiration_date: date | None = None
    supplier_id: int | None = None
    purchase_order_id: int | None = None


class LotRead(BaseModel):
    id: int
    product_id: int
    lot_number: str
    manufacturing_date: date | None
    expiration_date: date | None
    supplier_id: int | None
    purchase_order_id: int | None


class LotBalanceRead(BaseModel):
    """A lot with the stock it currently has at one location, in FEFO
    order (soonest-expiring first, undated lots last)."""

    lot: LotRead
    quantity: Decimal


class FefoAllocationEntry(BaseModel):
    lot_id: int
    lot_number: str
    expiration_date: date | None
    quantity: Decimal


class FefoPlanRequest(BaseModel):
    warehouse_id: int
    location_id: int
    quantity: Decimal = Field(gt=0)


class FefoPlanResponse(BaseModel):
    allocations: list[FefoAllocationEntry]


class FefoConsumeRequest(BaseModel):
    """Manual FEFO-ordered stock reduction. ``SALE`` is deliberately not an
    option here — phase 11 calls ``app.lots.service.execute_fefo_consumption``
    directly from checkout, with its own ``sale`` reference; this endpoint
    is for the manual corrections that should still respect FEFO."""

    warehouse_id: int
    location_id: int
    quantity: Decimal = Field(gt=0)
    movement_type: Literal["ADJUSTMENT", "WASTE"] = "ADJUSTMENT"
    unit_cost: Decimal = Field(default=Decimal(0), ge=0)
    reason: str = Field(default="", max_length=500)


class FefoConsumeResponse(BaseModel):
    allocations: list[FefoAllocationEntry]
    movement_ids: list[int]
