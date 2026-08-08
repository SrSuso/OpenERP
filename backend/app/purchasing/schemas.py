"""Pydantic schemas for purchasing."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class PurchaseOrderCreate(BaseModel):
    supplier_id: int
    notes: str = Field(default="", max_length=2000)


class PurchaseOrderLineCreate(BaseModel):
    product_id: int
    package_id: int
    quantity_packages: Decimal = Field(gt=0)
    #: Cost per unit of the chosen package, as quoted/invoiced.
    unit_cost: Decimal = Field(ge=0)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0)
    discount_rate: Decimal = Field(default=Decimal(0), ge=0, le=100)


class PurchaseOrderLineRead(BaseModel):
    id: int
    product_id: int
    product_sku: str
    product_name: str
    package_id: int
    package_name: str
    package_factor: Decimal
    quantity_packages: Decimal
    quantity_ordered: Decimal
    quantity_received: Decimal
    unit_cost: Decimal
    tax_rate: Decimal
    discount_rate: Decimal
    #: Computed, not stored — deterministic from the snapshots above, so
    #: there is nothing to keep in sync.
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total: Decimal


class PurchaseOrderRead(BaseModel):
    id: int
    supplier_id: int
    supplier_name: str
    status: str
    notes: str
    ordered_at: datetime | None
    created_at: datetime
    lines: list[PurchaseOrderLineRead]
    total: Decimal


class ProductPurchaseHistoryEntry(BaseModel):
    purchase_order_id: int
    date: datetime
    status: str
    supplier_id: int
    supplier_name: str
    package_name: str
    quantity_packages: Decimal
    unit_cost: Decimal
