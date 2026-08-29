"""Pydantic schemas for sales."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class SaleCreate(BaseModel):
    warehouse_id: int
    location_id: int
    #: Required by the browser POS. Nullable at the generic domain boundary
    #: for historical imports and any future non-POS sale source.
    terminal_id: int | None = None
    notes: str = Field(default="", max_length=2000)


class SaleLineCreate(BaseModel):
    product_id: int
    package_id: int
    quantity_packages: Decimal = Field(gt=0)
    #: Final amount shown to the customer, only valid for a product whose
    #: administrator enabled `is_open_price`. The service derives the
    #: stored net/gross unit price from the store's tax configuration.
    open_price_total: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    discount_rate: Decimal = Field(default=Decimal(0), ge=0, le=100)
    #: The browser may request the configured cold-drink option, but never
    #: chooses its amount: sales.service resolves and snapshots it.
    cold_drink: bool = False
    #: The browser selects a code only; the service resolves its configured
    #: amount server-side and allows one supplement per sale line.
    pos_surcharge: Literal["COLD_DRINK", "BAG_LARGE", "BAG_MEDIUM", "BAG_SMALL"] | None = None


class SaleLineByBarcodeCreate(BaseModel):
    """Convenience for the POS grid/scanner (phase 12): resolve the product
    and package by barcode instead of making the frontend look them up
    first."""

    barcode: str = Field(min_length=1, max_length=64)
    quantity_packages: Decimal = Field(default=Decimal(1), gt=0)
    discount_rate: Decimal = Field(default=Decimal(0), ge=0, le=100)
    cold_drink: bool = False
    pos_surcharge: Literal["COLD_DRINK", "BAG_LARGE", "BAG_MEDIUM", "BAG_SMALL"] | None = None


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
    #: Economic and physical return capacity are consumed independently.
    quantity_refunded: Decimal
    quantity_physically_returned: Decimal
    tracks_stock: bool
    track_lots: bool
    #: Price of one selected package, computed from the line snapshots. The
    #: current catalogue prices base units; packages have no price override.
    package_price: Decimal
    unit_price: Decimal
    cold_drink_surcharge: Decimal
    pos_surcharge_label: str | None
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
    #: El número impreso en el ticket. `None` mientras no se ha cobrado —
    #: ver `app.sales.models.Sale.number`.
    number: int | None
    warehouse_id: int
    location_id: int
    terminal_id: int | None
    terminal_name: str | None
    status: str
    notes: str
    cashier_user_id: int | None
    cashier_name: str | None
    #: Null while the sale is a draft; frozen to the checkout setting once
    #: completed so historical totals never depend on current configuration.
    prices_include_tax: bool | None
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
