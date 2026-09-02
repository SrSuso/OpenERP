"""Pydantic schemas for the product catalog."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, Field


class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    #: Los mismos valores por defecto que se pueden cambiar después desde
    #: precios. Se aceptan aquí para que una categoría quede lista desde su
    #: creación; la validación de fórmula e impuestos sigue viviendo en
    #: ``app.pricing``.
    tracks_stock: bool = True
    is_sold_by_weight: bool = False
    default_unit_name: str | None = Field(default=None, max_length=20)
    margin_rate: Decimal | None = Field(default=None, ge=0)
    margin_amount: Decimal | None = Field(default=None, ge=0)
    price_formula: str | None = Field(default=None, max_length=500)
    tax_ids: list[int] = Field(default_factory=list)


class ProductCategoryUpdate(BaseModel):
    """El nombre y si sus productos llevan control de existencias. El
    margen/impuestos por defecto se cambian desde
    PATCH /product-categories/{id}/pricing (app.pricing.router), y
    `is_active` desde deactivate/activate."""

    name: str = Field(min_length=1, max_length=100)
    tracks_stock: bool = True
    #: ``None`` preserves existing categories for older callers that only
    #: rename or change stock control.
    is_sold_by_weight: bool | None = None
    #: Ausente = conservar; ``null`` = dejar la categoría sin propuesta.
    default_unit_name: str | None = Field(default=None, max_length=20)


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
    #: Las otras dos formas de poner precio que heredan sus productos: una
    #: cantidad fija en euros sobre el coste, o una fórmula propia.
    #: ``None`` en las dos = no se dice nada aquí.
    margin_amount: Decimal | None
    price_formula: str | None
    #: Si sus productos llevan control de existencias, salvo que el
    #: producto diga lo contrario — ver `app.catalog.stock`.
    tracks_stock: bool
    #: Resuelve la regla de venta por peso de la categoría para que el POS
    #: no tenga que cargar ni interpretar categorías por su cuenta.
    is_sold_by_weight: bool
    default_unit_name: str | None
    taxes: list[ProductTaxRead]


class ImageUpload(BaseModel):
    """La foto, ya reescalada por el navegador, como data URL — ver
    `app.catalog.images.decode` sobre por qué así y no multipart."""

    data_url: str = Field(min_length=1, max_length=2_000_000)


class ImageRead(BaseModel):
    entity_id: int
    #: Sube con cada reemplazo; va en la URL de la foto (`?v=`) para que el
    #: navegador no se quede con la anterior.
    version: int


class UnitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=20)


class UnitUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=20)


class UnitRead(BaseModel):
    id: int
    name: str
    display_order: int


class UnitMoveDirection(StrEnum):
    up = "up"
    down = "down"


class UnitMoveRequest(BaseModel):
    direction: UnitMoveDirection


_HEX_COLOR = r"^#[0-9A-Fa-f]{6}$"


class PosCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#64748b", pattern=_HEX_COLOR)
    display_order: int = Field(default=0, ge=0)
    is_default: bool = False


class PosCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=_HEX_COLOR)
    display_order: int | None = Field(default=None, ge=0)
    is_default: bool | None = None


class PosCategoryRead(BaseModel):
    id: int
    name: str
    color: str
    display_order: int
    is_default: bool
    is_active: bool


class PackageCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    factor: Decimal = Field(gt=0)
    barcode: str | None = Field(default=None, min_length=1, max_length=64)


class BarcodeRead(BaseModel):
    id: int
    barcode: str


class PackageRead(BaseModel):
    id: int
    name: str
    factor: Decimal
    is_base: bool
    barcodes: list[BarcodeRead]


class BarcodeCreate(BaseModel):
    barcode: str = Field(min_length=1, max_length=64)


class BarcodeUpdate(BaseModel):
    barcode: str = Field(min_length=1, max_length=64)


class InitialStockCreate(BaseModel):
    """Opening quantity for a new product.

    It deliberately describes a stock coordinate, not a mutable product
    field: the service records an immutable ``ADJUSTMENT`` ledger entry.
    """

    warehouse_id: int
    location_id: int
    quantity: Decimal = Field(gt=0)
    lot_number: str | None = Field(default=None, min_length=1, max_length=100)
    expiration_date: date | None = None


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
    pos_display_order: int = Field(default=1, ge=0)
    is_open_price: bool = False
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
    #: Igual, pero en dinero: euros sobre el coste. Ver
    #: `app.catalog.models.Product.margin_amount`.
    margin_amount: Decimal | None = Field(default=None, ge=0)
    min_stock: Decimal = Field(default=Decimal(0), ge=0)
    track_lots: bool = False
    track_expiration: bool = False
    #: ``None`` = lo que diga su categoría. Ver `app.catalog.stock`.
    tracks_stock: bool | None = None
    #: Optional opening balance recorded atomically with the product.  A
    #: lot-tracked opening balance carries its printed lot number too.
    initial_stock: InitialStockCreate | None = None


class ProductUpdate(BaseModel):
    """Catalog-only fields. Cost/price/tax/surcharge/margin/formula are
    ``app.pricing``'s exclusive write path from here on (phase 4) — that is
    the only way ``product_price_history`` stays complete."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    category_id: int | None = None
    pos_category_id: int | None = None
    pos_display_order: int | None = Field(default=None, ge=0)
    is_open_price: bool | None = None
    #: Código principal del formato base. ``null`` lo elimina; los códigos
    #: adicionales siguen gestionándose desde Formatos.
    base_barcode: str | None = Field(default=None, min_length=1, max_length=64)
    #: La unidad se puede corregir mientras el producto todavía no tenga
    #: historial ni formatos derivados. El servicio protege esa condición
    #: para que un cambio no reinterprete cantidades ya guardadas.
    base_unit_name: str | None = Field(default=None, min_length=1, max_length=20)
    min_stock: Decimal | None = Field(default=None, ge=0)
    track_lots: bool | None = None
    track_expiration: bool | None = None
    #: Tres estados: `True`/`False` lo fijan en el producto, y omitirlo lo
    #: deja como estaba. Para volver a heredar de la categoría se manda
    #: `inherit_tracks_stock`.
    tracks_stock: bool | None = None
    inherit_tracks_stock: bool = False


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
    is_open_price: bool
    #: La categoría del producto decide este comportamiento de caja; no es
    #: un dato que pueda enviar el navegador al crear la línea.
    is_sold_by_weight: bool
    base_unit_name: str
    cost: Decimal
    list_price: Decimal
    #: PVP vigente: el redondeado automático o el precio manual, según cuál
    #: sea aplicable. Es la referencia que usa el POS para nuevas ventas.
    final_price: Decimal
    #: Si es ``True``, los cambios de coste, impuestos o márgenes actualizan
    #: el cálculo mostrado, pero nunca sustituyen el PVP Final fijado.
    manual_price_is_set: bool
    tax_rate: Decimal
    surcharge_rate: Decimal
    #: El tipo que de verdad se le aplica, resuelto ya (impuestos propios,
    #: si no los de su categoría, si no la columna de arriba) — ver
    #: `app.catalog.taxes`. Es lo que debe salir por defecto al comprarlo o
    #: al venderlo; `tax_rate` es sólo el valor suelto heredado.
    effective_tax_rate: Decimal
    #: ``None`` = inherits the category's margin — see this module's own
    #: `ProductCategoryRead` docstring on the override priority.
    margin_rate: Decimal | None
    #: Lo mismo en dinero — ``None`` = hereda el de su categoría.
    margin_amount: Decimal | None
    #: Explicit tax override; empty means "inherits the category's taxes"
    #: (`ProductCategoryRead.taxes`), not "no tax applies".
    taxes: list[ProductTaxRead]
    price_formula: str | None
    min_stock: Decimal
    track_lots: bool
    track_expiration: bool
    #: Lo elegido en este producto; `None` = hereda de su categoría.
    tracks_stock: bool | None
    #: Lo que de verdad se aplica, ya resuelto — ver `app.catalog.stock`.
    effective_tracks_stock: bool
    is_active: bool
    packages: list[PackageRead]
