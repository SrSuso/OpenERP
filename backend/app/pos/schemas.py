"""API contracts for the deliberately small POS-terminal registry."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PosTerminalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    warehouse_id: int


class PosTerminalUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    is_active: bool | None = None
    show_product_search: bool | None = None

    @model_validator(mode="after")
    def _has_change(self) -> PosTerminalUpdate:
        if self.name is None and self.is_active is None and self.show_product_search is None:
            raise ValueError("At least one terminal field must be changed.")
        return self


class PosTerminalRead(BaseModel):
    id: int
    name: str
    warehouse_id: int
    warehouse_name: str
    is_active: bool
    show_product_search: bool
    created_at: datetime
