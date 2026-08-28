"""Store-facing schemas for low-stock and expiration alerts."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class StockGeneralRead(BaseModel):
    enabled: bool
    min_stock: Decimal = Field(ge=0)


class StockGeneralUpdate(BaseModel):
    enabled: bool
    min_stock: Decimal = Field(ge=0)


class ExpirationGeneralRead(BaseModel):
    enabled: bool
    days_before_expiration: int = Field(ge=0, le=365)


class ProductExpirationRead(BaseModel):
    product_id: int
    product_name: str
    days_before_expiration: int = Field(ge=0, le=365)


class NotificationSettingsRead(BaseModel):
    stock_general: StockGeneralRead
    general_expiration: ExpirationGeneralRead
    product_expirations: list[ProductExpirationRead]


class ExpirationGeneralUpdate(BaseModel):
    enabled: bool
    days_before_expiration: int = Field(ge=0, le=365)


class ProductExpirationUpdate(BaseModel):
    days_before_expiration: int = Field(ge=0, le=365)


class ActiveAlertRead(BaseModel):
    id: int
    kind: Literal["LOW_STOCK", "EXPIRATION"]
    title: str
    product_id: int
    stock_current: Decimal | None = None
    min_stock: Decimal | None = None
    replenish: Decimal | None = None
    lot_id: int | None = None
    lot_number: str | None = None
    expiration_date: date | None = None
    days_remaining: int | None = None
    quantity_remaining: Decimal | None = None
