"""Pydantic schemas for the product catalog."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field


class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ProductTaxRead(BaseModel):
    """Minimal view of a `Tax` (app.pricing.models) as seen from a product
    or category — the full CRUD lives in app.pricing, this is just enough
    to show what's assigned. A plain duplicate of the shape rather than an
    import from app.pricing.schemas: catalog has no reason to depend on
    pricing's module layout, only on the `id`/`name`/`rate` a `Tax` row
    actually has."""

    id: int
    name: str
    rate: Decimal


class ProductCategoryRead(BaseModel):
    id: int
    name: str
    is_active: bool
    #: Category-level pricing defaults — see app.pricing.service's own
    #: docstring on effective_margin_rate/effective_tax_rate for how a
    #: product's explicit value overrides these. Managed from
    #: PATCH /product-categories/{id}/pricing (app.pricing.router), not
    #: from this module's own endpoints.
    margin_rate: Decimal | None
    taxes: list[ProductTaxRead]


class UnitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=20)


class UnitRead(BaseModel):
    id: int
    name: str


_HEX_COLOR = r"^#[0-9A-Fa-f]{6}$"


class PosCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#64748b", pattern=_HEX_COLOR)
    display_order: int = Field(default=0, ge=0)


class PosCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=_HEX_COLOR)
    display_order: int | None = Field(default=None, ge=0)


class PosCategoryRead(BaseModel):
    id: int
    name: str
    color: str
    display_order: int
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
    #: ``None`` (the normal case from the admin panel — nobody types a SKU
    #: any more) auto-generates one in app.catalog.service.create_product
    #: (``P######`` from the new row's own id) purely as the internal
    #: reference every other module already keys off (sales/returns/
    #: purchasing/inventory/lots/notifications/dashboards) — never shown as
    #: something to manage. An explicit value is still accepted (scripts,
    #: imports) and must be unique like before.
    sku: str | None = Field(default=None, min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    category_id: int | None = None
    pos_category_id: int | None = None
    pos_display_order: int = Field(default=0, ge=0)
    base_unit_name: str = Field(min_length=1, max_length=20)
    base_barcode: str | None = Field(default=None, min_length=1, max_length=64)
    cost: Decimal = Field(ge=0)
    #: Still a plain, required, manual value here — creating a product
    #: never silently recomputes it. The admin panel gets the "PVP
    #: automático" the user actually asked for by calling
    #: `POST /pricing/preview` (already existed, phase 4) as the person
    #: types cost/margin/taxes and sending *that* as this field — a live
    #: preview, not a hidden server-side override. Real automatic
    #: recomputation only ever happens on an explicit pricing change from
    #: here on (`PATCH /products/{id}/pricing`,
    #: `PATCH /product-categories/{id}/pricing`, the global formula
    #: setting) — see app.pricing.service.
    list_price: Decimal = Field(ge=0)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0)
    surcharge_rate: Decimal = Field(default=Decimal(0), ge=0)
    #: ``None`` = no override, inherit the category's margin (or 0 if the
    #: category has none either) — see ProductCategoryRead's own docstring.
    margin_rate: Decimal | None = Field(default=None, ge=0)
    min_stock: Decimal = Field(default=Decimal(0), ge=0)
    track_lots: bool = False
    track_expiration: bool = False


class ProductUpdate(BaseModel):
    """Catalog-only fields. Cost/price/tax/surcharge/margin/formula are
    ``app.pricing``'s exclusive write path from here on (phase 4) — that is
    the only way ``product_price_history`` stays complete."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    category_id: int | None = None
    pos_category_id: int | None = None
    pos_display_order: int | None = Field(default=None, ge=0)
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
    pos_category_id: int | None
    pos_category_name: str | None
    pos_display_order: int
    base_unit_name: str
    cost: Decimal
    list_price: Decimal
    tax_rate: Decimal
    surcharge_rate: Decimal
    #: ``None`` = inherits the category's margin — see this module's own
    #: `ProductCategoryRead` docstring on the override priority.
    margin_rate: Decimal | None
    #: Explicit tax override; empty means "inherits the category's taxes"
    #: (`ProductCategoryRead.taxes`), not "no tax applies".
    taxes: list[ProductTaxRead]
    price_formula: str | None
    min_stock: Decimal
    track_lots: bool
    track_expiration: bool
    is_active: bool
    packages: list[PackageRead]
