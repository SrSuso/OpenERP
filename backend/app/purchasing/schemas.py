"""Pydantic schemas for purchasing."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class PurchaseOrderLineCreate(BaseModel):
    product_id: int
    package_id: int
    quantity_packages: Decimal = Field(gt=0)
    #: Cost per selected base unit, as quoted/invoiced.
    unit_cost: Decimal = Field(ge=0)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0)
    discount_rate: Decimal = Field(default=Decimal(0), ge=0, le=100)


class PurchaseOrderCreate(BaseModel):
    supplier_id: int
    notes: str = Field(default="", max_length=2000)
    #: The purchase screen stages several lines locally and sends them with
    #: the order in one request, so an invalid line cannot leave a half-made
    #: order behind. An empty draft remains valid for API callers that need
    #: to complete it later.
    lines: list[PurchaseOrderLineCreate] = Field(default_factory=list)


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


class GoodsReceiptLineCreate(BaseModel):
    purchase_order_line_id: int
    #: Physically received, in that line's package — what the delivery note
    #: says, which may be less than what was ordered.
    quantity_packages: Decimal = Field(gt=0)
    #: Only meaningful (and only used) for a lot-tracked product. Reuses an
    #: existing lot with this number for the product if one exists,
    #: otherwise creates it.
    lot_number: str | None = Field(default=None, max_length=100)
    manufacturing_date: date | None = None
    expiration_date: date | None = None


class GoodsReceiptCreate(BaseModel):
    warehouse_id: int
    location_id: int
    notes: str = Field(default="", max_length=2000)
    lines: list[GoodsReceiptLineCreate] = Field(min_length=1)


class GoodsReceiptLineRead(BaseModel):
    id: int
    purchase_order_line_id: int
    product_id: int
    product_sku: str
    product_name: str
    quantity_packages: Decimal
    lot_id: int | None
    lot_number: str | None
    stock_movement_id: int | None


class ReceivedCostProposalRead(BaseModel):
    """A catalog-cost change derived from a persisted receipt line.

    ``received_unit_cost`` is always in the product's base unit.  It is a
    proposal, not a write: recording a receipt must remain independent from
    the commercial decision to update the catalog.
    """

    receipt_line_id: int
    product_id: int
    product_sku: str
    product_name: str
    current_catalog_cost: Decimal
    received_unit_cost: Decimal
    difference: Decimal


class GoodsReceiptRead(BaseModel):
    id: int
    purchase_order_id: int
    warehouse_id: int
    location_id: int
    notes: str
    received_at: datetime
    lines: list[GoodsReceiptLineRead]
    cost_proposals: list[ReceivedCostProposalRead]


class ApplyReceivedCostLine(BaseModel):
    """The client selects a persisted receipt line, never a new cost."""

    receipt_line_id: int
    expected_current_cost: Decimal = Field(ge=0)


class ApplyReceivedCostsRequest(BaseModel):
    lines: list[ApplyReceivedCostLine] = Field(min_length=1)
