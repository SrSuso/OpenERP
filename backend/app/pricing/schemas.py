"""Pydantic schemas for pricing."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


def _at_most_one_tax(value: list[int] | None) -> list[int] | None:
    """Un producto (o una categoría) tiene *un* tipo de IVA, no una suma de
    varios: dos elegidos darían un 31% que no existe. Se permitían varios
    cuando así se representaba "IVA + recargo de equivalencia"; desde que
    el recargo es una columna del propio impuesto (`Tax.surcharge_rate`)
    apilar ya no hace falta.

    Vacío sigue significando "hereda", que es distinto de "sin impuesto".
    """
    if value is not None and len(value) > 1:
        raise ValueError(
            "Sólo se puede aplicar un impuesto: dos tipos de IVA a la vez se sumarían "
            "y darían una tasa que no existe."
        )
    return value


class FormulaPreviewRequest(BaseModel):
    """Try a formula against sample inputs without touching a real product —
    for building/testing a formula before saving it."""

    formula: str = Field(min_length=1, max_length=500)
    cost: Decimal = Field(default=Decimal(0), ge=0)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0)
    surcharge_rate: Decimal = Field(default=Decimal(0), ge=0)
    margin_rate: Decimal = Field(default=Decimal(0), ge=0)


class FormulaPreviewResponse(BaseModel):
    result: Decimal


class SetPricingInputsRequest(BaseModel):
    """Updates whichever pricing inputs are given (a field simply absent
    from the JSON body is left untouched). If the product already has a
    formula, changing ``cost``/``tax_rate``/``surcharge_rate`` recomputes
    its price from it, same as before this had ``margin_rate``/
    ``tax_ids``. Those last two are new and behave differently on purpose:
    touching either one *always* recomputes the price (using the
    product's own formula, or the store-wide default if it has none) even
    without one set — margin/taxes changing is exactly the moment "PVP
    calculado automáticamente" is supposed to kick in. A manually-priced
    product (``PUT .../manual-price``) that never has its margin/taxes
    touched again keeps that exact price forever.

    ``margin_rate: null`` (present, explicitly null) clears the product's
    own margin back to "inherit the category's"; omitting the key leaves
    it as-is. Same idea for ``tax_ids``: present with an empty list clears
    the product's own tax override back to "inherit the category's".
    """

    cost: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=None, ge=0)
    surcharge_rate: Decimal | None = Field(default=None, ge=0)
    margin_rate: Decimal | None = Field(default=None, ge=0)
    tax_ids: list[int] | None = Field(default=None)

    @field_validator("tax_ids")
    @classmethod
    def _at_most_one(cls, value: list[int] | None) -> list[int] | None:
        return _at_most_one_tax(value)


class TaxCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rate: Decimal = Field(ge=0)
    #: Recargo de equivalencia que acompaña a esta tasa — ver `Tax`.
    surcharge_rate: Decimal = Field(default=Decimal(0), ge=0)


class TaxUpdate(BaseModel):
    """Editar un impuesto ya creado — nombre y/o tasa, lo que se mande.
    Cambiar la tasa recalcula, sola, el precio de cada producto que lo
    tenga aplicado (propio o heredado de su categoría) — mismo mecanismo
    que un cambio de fórmula, ver app.pricing.service.update_tax."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    rate: Decimal | None = Field(default=None, ge=0)
    surcharge_rate: Decimal | None = Field(default=None, ge=0)


class TaxRead(BaseModel):
    id: int
    name: str
    rate: Decimal
    surcharge_rate: Decimal
    is_active: bool


class CategoryPricingUpdate(BaseModel):
    """Same presence-sensitive semantics as `SetPricingInputsRequest`'s
    margin_rate/tax_ids — see its docstring. Saving either one here always
    recomputes every product in the category that doesn't have its own
    explicit override (see app.pricing.service.update_category_pricing)."""

    margin_rate: Decimal | None = Field(default=None, ge=0)
    tax_ids: list[int] | None = Field(default=None)

    @field_validator("tax_ids")
    @classmethod
    def _at_most_one(cls, value: list[int] | None) -> list[int] | None:
        return _at_most_one_tax(value)


class PricingSettingsRead(BaseModel):
    formula: str
    prices_include_tax: bool


class PricingSettingsUpdate(BaseModel):
    formula: str = Field(min_length=1, max_length=2000)
    prices_include_tax: bool


class SetFormulaRequest(BaseModel):
    price_formula: str = Field(min_length=1, max_length=500)


class SetManualPriceRequest(BaseModel):
    list_price: Decimal = Field(ge=0)


class PriceHistoryEntryRead(BaseModel):
    id: int
    product_id: int
    cost: Decimal
    tax_rate: Decimal
    surcharge_rate: Decimal
    margin_rate: Decimal
    price_formula: str | None
    list_price: Decimal
    created_at: datetime
