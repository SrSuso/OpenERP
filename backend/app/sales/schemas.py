"""Pydantic schemas for sales."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class SaleCreate(BaseModel):
    warehouse_id: int
    location_id: int
    notes: str = Field(default="", max_length=2000)


class SaleLineCreate(BaseModel):
    product_id: int
    package_id: int
    quantity_packages: Decimal = Field(gt=0)
    discount_rate: Decimal = Field(default=Decimal(0), ge=0, le=100)


class SaleLineByBarcodeCreate(BaseModel):
    """Convenience for the POS grid/scanner (phase 12): resolve the product
    and package by barcode instead of making the frontend look them up
    first."""

    barcode: str = Field(min_length=1, max_length=64)
    quantity_packages: Decimal = Field(default=Decimal(1), gt=0)
    discount_rate: Decimal = Field(default=Decimal(0), ge=0, le=100)


class SaleLineRead(BaseModel):
    id: int
    product_id: int
    product_sku: str
    product_name: str
    package_id: int
    package_name: str
    package_factor: Decimal
    quantity_packages: Decimal
    quantity_base: Decimal
    unit_price: Decimal
    tax_rate: Decimal
    discount_rate: Decimal
    #: Computed, not stored — deterministic from the snapshots above, so
    #: there is nothing to keep in sync.
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total: Decimal


class SaleRead(BaseModel):
    id: int
    warehouse_id: int
    location_id: int
    status: str
    notes: str
    cashier_user_id: int | None
    completed_at: datetime | None
    created_at: datetime
    lines: list[SaleLineRead]
    total: Decimal
