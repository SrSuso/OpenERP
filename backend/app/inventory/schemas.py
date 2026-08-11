"""Pydantic schemas for the inventory ledger."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class WarehouseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class WarehouseRead(BaseModel):
    id: int
    name: str
    is_active: bool


class LocationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class LocationRead(BaseModel):
    id: int
    warehouse_id: int
    name: str
    is_active: bool


class StockMovementRead(BaseModel):
    id: int
    product_id: int
    product_sku: str
    warehouse_id: int
    location_id: int
    lot_id: int | None
    quantity: Decimal
    movement_type: str
    reference_type: str | None
    reference_id: int | None
    unit_cost: Decimal
    user_id: int | None
    created_at: datetime


class StockBalanceRead(BaseModel):
    product_id: int
    product_sku: str
    #: El nombre es lo que se lee en pantalla; el SKU es la referencia
    #: interna, que se sigue mandando para quien la necesite.
    product_name: str
    warehouse_id: int
    warehouse_name: str
    location_id: int
    location_name: str
    lot_id: int | None
    quantity: Decimal


class ProductStockTotal(BaseModel):
    """Cuánto hay de un producto en total, sumando ubicaciones y lotes."""

    product_id: int
    quantity: Decimal


class AdjustmentCreate(BaseModel):
    product_id: int
    warehouse_id: int
    location_id: int
    movement_type: Literal["ADJUSTMENT", "WASTE"]
    #: Signed for ADJUSTMENT; WASTE is always a loss and may be given as
    #: either sign — it is normalised to negative.
    quantity: Decimal
    unit_cost: Decimal = Field(ge=0)
    lot_id: int | None = None
    reason: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def _validate_and_normalise(self) -> AdjustmentCreate:
        if self.quantity == 0:
            raise ValueError("quantity must not be zero.")
        if self.movement_type == "WASTE" and self.quantity > 0:
            self.quantity = -self.quantity
        return self


class TransferCreate(BaseModel):
    product_id: int
    from_warehouse_id: int
    from_location_id: int
    to_warehouse_id: int
    to_location_id: int
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal = Field(ge=0)
    lot_id: int | None = None


class TransferResult(BaseModel):
    out_movement: StockMovementRead
    in_movement: StockMovementRead
