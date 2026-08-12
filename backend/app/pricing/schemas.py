"""Pydantic schemas for pricing."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class FormulaPreviewRequest(BaseModel):
    """Try a formula against sample inputs without touching a real product —
    for building/testing a formula before saving it."""

    formula: str = Field(min_length=1, max_length=500)
    cost: Decimal = Field(default=Decimal(0), ge=0)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0)
    surcharge_rate: Decimal = Field(default=Decimal(0), ge=0)
    margin_rate: Decimal = Field(default=Decimal(0), ge=0)
    margin_amount: Decimal = Field(default=Decimal(0), ge=0)


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
    #: El margen en dinero, con las mismas reglas de presencia que
    #: `margin_rate`: ausente = no se toca, ``null`` = vuelve a heredar el
    #: de su categoría. Ver `app.catalog.models.Product.margin_amount`.
    margin_amount: Decimal | None = Field(default=None, ge=0)
    tax_ids: list[int] | None = Field(default=None)


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
    margin_rate/tax_ids — see its docstring. Saving any of these always
    recomputes every product in the category that doesn't have its own
    explicit override (see app.pricing.service.update_category_pricing).

    Las tres formas de poner precio que se heredan: un porcentaje sobre el
    coste, una cantidad fija en euros, o una fórmula. Un producto puede
    llevar la contraria en cualquiera de las tres."""

    margin_rate: Decimal | None = Field(default=None, ge=0)
    margin_amount: Decimal | None = Field(default=None, ge=0)
    #: Cadena vacía = quitar la fórmula de la categoría (vuelve a la de la
    #: tienda), igual que ``null``.
    price_formula: str | None = Field(default=None, max_length=500)
    tax_ids: list[int] | None = Field(default=None)


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
    margin_amount: Decimal
    price_formula: str | None
    list_price: Decimal
    created_at: datetime
