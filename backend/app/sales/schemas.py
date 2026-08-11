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
    #: Already given back through a return (phase 14) — 0 until one exists.
    quantity_returned: Decimal
    unit_price: Decimal
    tax_rate: Decimal
    discount_rate: Decimal
    #: Computed, not stored — deterministic from the snapshots above, so
    #: there is nothing to keep in sync.
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total: Decimal


class PaymentCreate(BaseModel):
    method: str = Field(pattern="^(CASH|CARD|OTHER)$")
    #: What the customer tendered — may exceed the balance due (change is
    #: computed and returned, never stored as a negative payment).
    amount: Decimal = Field(gt=0)


class CheckoutRequest(BaseModel):
    payments: list[PaymentCreate] = Field(min_length=1)


class PaymentRead(BaseModel):
    id: int
    method: str
    amount: Decimal
    created_at: datetime


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
    payments: list[PaymentRead]
    #: Cash handed back to the customer on the last checkout — 0 unless
    #: ``status == COMPLETED`` and a cash tender overshot the total.
    change_due: Decimal


class ZReportRead(BaseModel):
    """El cierre de caja, tal y como se guardó — ver `app.sales.z_reports`."""

    id: int
    warehouse_id: int
    number: int
    #: Nulo en la primera Z de esa caja: antes no había corte.
    covers_from: datetime | None
    closed_at: datetime
    sales_count: int
    gross_total: Decimal
    tax_total: Decimal
    discount_total: Decimal
    cash_total: Decimal
    card_total: Decimal
    other_total: Decimal
    returns_count: int
    returns_total: Decimal
    closed_by_user_id: int | None


class PendingSaleRead(BaseModel):
    """Una venta a medias, lo justo para reconocerla en pantalla."""

    id: int
    lines_count: int
    total: Decimal


class ZReportPreview(BaseModel):
    """Lo mismo, pero sin guardar ni numerar: lo que se enseña antes de
    confirmar el cierre."""

    covers_from: datetime | None
    sales_count: int
    gross_total: Decimal
    tax_total: Decimal
    discount_total: Decimal
    cash_total: Decimal
    card_total: Decimal
    other_total: Decimal
    returns_count: int
    returns_total: Decimal
    #: Las ventas sin cobrar que impiden cerrar. Van enteras y no contadas:
    #: "hay una sin cobrar" sin decir cuál deja sin salida a quien está en
    #: el mostrador.
    open_sales: list[PendingSaleRead]
