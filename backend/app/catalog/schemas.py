"""Pydantic schemas for the product catalog."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field


class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ProductCategoryRead(BaseModel):
    id: int
    name: str
    is_active: bool


class PackageCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    factor: Decimal = Field(gt=0)
    barcode: str | None = Field(default=None, min_length=1, max_length=64)


class PackageRead(BaseModel):
    id: int
    name: str
    factor: Decimal
    is_base: bool
    barcodes: list[str]


class BarcodeCreate(BaseModel):
    barcode: str = Field(min_length=1, max_length=64)


class ProductCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    category_id: int | None = None
    base_unit_name: str = Field(min_length=1, max_length=20)
    base_barcode: str | None = Field(default=None, min_length=1, max_length=64)
    cost: Decimal = Field(ge=0)
    list_price: Decimal = Field(ge=0)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0)
    min_stock: Decimal = Field(default=Decimal(0), ge=0)
    track_lots: bool = False
    track_expiration: bool = False


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    category_id: int | None = None
    cost: Decimal | None = Field(default=None, ge=0)
    list_price: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=None, ge=0)
    min_stock: Decimal | None = Field(default=None, ge=0)
    track_lots: bool | None = None
    track_expiration: bool | None = None


class ProductRead(BaseModel):
    id: int
    sku: str
    name: str
    description: str
    category_id: int | None
    category_name: str | None
    base_unit_name: str
    cost: Decimal
    list_price: Decimal
    tax_rate: Decimal
    min_stock: Decimal
    track_lots: bool
    track_expiration: bool
    is_active: bool
    packages: list[PackageRead]
