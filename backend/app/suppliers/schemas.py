"""Pydantic schemas for suppliers."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field


class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    tax_id: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    address: str = Field(default="", max_length=500)


class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    tax_id: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    address: str | None = Field(default=None, max_length=500)


class SupplierRead(BaseModel):
    id: int
    name: str
    tax_id: str | None
    email: str | None
    phone: str | None
    address: str
    is_active: bool


class ProductSupplierUpsert(BaseModel):
    supplier_sku: str | None = Field(default=None, max_length=50)
    supplier_cost: Decimal = Field(ge=0)
    is_preferred: bool = False


class ProductSupplierRead(BaseModel):
    id: int
    product_id: int
    product_sku: str
    product_name: str
    supplier_id: int
    supplier_name: str
    supplier_sku: str | None
    supplier_cost: Decimal
    is_preferred: bool
