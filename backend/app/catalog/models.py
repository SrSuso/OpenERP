"""Products, their presentations (packages) and barcodes.

Stock (from phase 7 onward) is always held in a product's base unit — rule
3. A package's ``factor`` is how many base units it is worth (rule 4); the
base presentation itself is just the package with ``factor == 1`` and
``is_base == True``, created automatically alongside the product so every
product always has exactly one. Correcting the base-unit label later never
rewrites ledger quantities or their package/price snapshots.
"""

from __future__ import annotations

from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.db.types import Money, Quantity, Rate, numeric

if TYPE_CHECKING:
    # Only for the type hints below — see app.pricing.models's own
    # docstring on why the relationships here use string secondary/target
    # names instead of a real import (pricing depends on catalog, not the
    # other way around; this stays type-checker-only to avoid a cycle).
    from app.pricing.models import Tax


class Unit(IntPrimaryKeyMixin, TimestampMixin, Base):
    """A managed list of base-unit names ("UNIT", "KG", "L"...) a product can
    be stocked in — purely a picker for the admin panel's "unidad base"
    dropdown. Deliberately *not* a foreign key from `Product`:
    `Product.base_unit_name` stays the free string it always was (rule 3,
    and every downstream module — purchasing, inventory, sales, lots,
    tickets — already reads it as one), so adding this table needed no
    migration touching any of them."""

    __tablename__ = "units"

    name: Mapped[str] = mapped_column(String(20), unique=True)
    #: User-controlled ordering for the dropdown (pedido explícitamente) —
    #: not an identity/insertion order. `app.catalog.service.move_unit`
    #: renormalises every row to 0..N-1 on each move, so ties from before
    #: the first move (every row still at its 0 default) never block
    #: reordering.
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ProductCategory(IntPrimaryKeyMixin, TimestampMixin, Base):
    """Independent from the POS-facing categories of phase 10 — a product's
    shelf category ("Lácteos") is not the same list as what a till button
    shows ("Ofertas")."""

    __tablename__ = "product_categories"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    #: Default margin/taxes for every product in this category — ``None``
    #: means "nothing set here", not "0%" (a category with no margin set
    #: contributes nothing to a product's effective margin, same as one
    #: with no taxes attached contributes no tax). A product's own
    #: `Product.margin_rate`/`Product.taxes`, when it has any, wins over
    #: this — see `app.pricing.service.effective_margin_rate`/
    #: `effective_tax_rate`, the only place that resolves the priority.
    margin_rate: Mapped[Decimal | None] = mapped_column(numeric(), nullable=True)
    #: Margen en dinero, no en porcentaje: «25 céntimos por unidad, sea lo
    #: que sea lo que me cueste». Se suma al final, después de impuestos y
    #: del margen porcentual, así que es lo que se gana limpio por unidad.
    #: Misma herencia que `margin_rate` — ``None`` es «aquí no se dice
    #: nada», no «0 €».
    margin_amount: Mapped[Decimal | None] = mapped_column(numeric(), nullable=True)
    #: Fórmula por defecto de la categoría, para cuando ni el porcentaje ni
    #: la cantidad fija sirven. ``None`` = usar la de la tienda. Un producto
    #: con `Product.price_formula` propia manda sobre ésta — ver
    #: `app.pricing.service.effective_formula`.
    price_formula: Mapped[str | None] = mapped_column(String(500), nullable=True)
    #: Si sus productos llevan control de existencias. Por defecto sí; un
    #: producto suyo puede decir lo contrario (ver `Product.tracks_stock`).
    tracks_stock: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    #: Los productos de esta categoría se venden introduciendo su peso en el
    #: POS. El precio del producto sigue siendo por unidad base (normalmente
    #: €/KG); la caja convierte los gramos introducidos a esa unidad antes de
    #: crear la línea de venta.
    is_sold_by_weight: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    #: Permite cambiar el PVP desde la lista de productos. Es una ayuda de
    #: administración independiente de la venta al peso: una categoría puede
    #: activar cualquiera de las dos opciones sin activar la otra.
    quick_price_edit: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    #: Unidad que se propone al crear un producto dentro de esta categoría.
    #: Es un nombre (como ``Product.base_unit_name``), no una conversión ni
    #: una regla de inventario; cada producto puede elegir otra si hace falta.
    default_unit_name: Mapped[str | None] = mapped_column(String(20), nullable=True)
    taxes: Mapped[list[Tax]] = relationship(
        secondary="category_taxes", order_by="Tax.name", viewonly=False
    )


class PosCategory(IntPrimaryKeyMixin, TimestampMixin, Base):
    """A till-button category (phase 10): groups products on the POS grid
    (phase 12) with a colour and a display order, independently from a
    product's shelf ``ProductCategory``. A product without one falls back
    to an "Otros" bucket at the frontend — this table never seeds a
    default row itself."""

    __tablename__ = "pos_categories"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    color: Mapped[str] = mapped_column(String(7), default="#64748b", server_default="'#64748b'")
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class StockAlertMode(StrEnum):
    """How a product obtains (or deliberately avoids) its stock threshold."""

    GENERAL = "GENERAL"
    CUSTOM = "CUSTOM"
    DISABLED = "DISABLED"


class Product(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint(
            "stock_alert_mode IN ('GENERAL', 'CUSTOM', 'DISABLED')",
            name="ck_products_stock_alert_mode",
        ),
    )

    sku: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(String(2000), default="")
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("product_categories.id"), nullable=True, index=True
    )
    #: Phase 10: which POS button/tab this product shows under. Independent
    #: from ``category_id`` — see :class:`PosCategory`.
    pos_category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("pos_categories.id"), nullable=True, index=True
    )
    #: Sort position of this product's button within its POS category grid
    #: (phase 12); lower first. Ties break by name at the query layer.
    pos_display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    #: A named POS button whose amount is entered by the cashier at sale
    #: time (for example, the total supplied by a deli counter). This is
    #: deliberately opt-in per product; ordinary catalogue prices remain
    #: authoritative and cannot be overridden by the browser.
    is_open_price: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    #: Name of the base inventory unit ("BRIK", "UNIT", "KG", ...). Every
    #: stock quantity for this product, everywhere, is expressed in this
    #: unit — see the base :class:`ProductPackage` (``factor == 1``).
    base_unit_name: Mapped[str] = mapped_column(String(20))

    #: Pricing inputs/output. Written at creation time here; every
    #: subsequent change goes exclusively through ``app.pricing`` (phase 4),
    #: which is what keeps ``product_price_history`` complete — there is no
    #: second, unaudited way to change a price.
    cost: Mapped[Money]
    list_price: Mapped[Money]
    #: Legacy single-rate field, kept for backward compatibility with every
    #: module that already reads it (history, tickets, dashboards...) and
    #: with the formula engine's ``tax_rate`` variable. No longer written by
    #: hand from the product form: `app.pricing.service.effective_tax_rate`
    #: computes it from `taxes`/the category's, and every write path that
    #: touches taxes keeps this column in sync as a cache of that sum.
    tax_rate: Mapped[Rate]
    # server_default (unlike the other Rate/Money columns): these two were
    # added in phase 4 to an already-shipped table, so existing rows need a
    # backfill value — the app itself always sends an explicit value on
    # every write from here on (ProductCreate defaults to 0, and every
    # later write goes through app.pricing).
    surcharge_rate: Mapped[Decimal] = mapped_column(numeric(), server_default="0")
    #: ``None`` = no explicit override, inherit the category's
    #: `ProductCategory.margin_rate` (also possibly ``None``, in which case
    #: the effective margin is 0) — see
    #: `app.pricing.service.effective_margin_rate`. Was ``NOT NULL DEFAULT
    #: 0`` before category-level margins existed, when "unset" and "0%"
    #: were the same thing; now they aren't, so this had to become nullable.
    margin_rate: Mapped[Decimal | None] = mapped_column(numeric(), nullable=True)
    #: Margen en dinero en vez de en porcentaje — «este me deja 25 céntimos
    #: y punto». ``None`` = lo que diga su categoría
    #: (`ProductCategory.margin_amount`), y si tampoco dice nada, 0 €. Ver
    #: `app.pricing.service.effective_margin_amount`.
    margin_amount: Mapped[Decimal | None] = mapped_column(numeric(), nullable=True)
    #: Si este producto lleva control de existencias. `None` = lo que diga
    #: su categoría (`ProductCategory.tracks_stock`), que es el caso normal.
    #:
    #: Apagado, el producto no se agota nunca: la venta no comprueba
    #: existencias ni mueve el almacén. Es lo que hace falta para lo que se
    #: vende a granel y se repone del saco sin contarlo, que si no obliga a
    #: ajustar el stock a mano cada mañana para que la caja no se plante.
    #: Ver `app.catalog.stock.tracks_stock`.
    tracks_stock: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    #: Explicit tax override for this product. Empty = inherit the
    #: category's `ProductCategory.taxes`; non-empty = these, and only
    #: these, apply — see `app.pricing.service.effective_tax_rate`. Several
    #: can apply at once (they stack additively, e.g. IVA + recargo de
    #: equivalencia).
    taxes: Mapped[list[Tax]] = relationship(
        secondary="product_taxes", order_by="Tax.name", viewonly=False
    )
    #: The pricing formula text; ``app.pricing.formula`` parses and
    #: evaluates it with a restricted AST walker (rule 12: never eval()).
    #: ``None`` uses the store-wide default formula
    #: (`app.pricing.models.PricingSettings`) instead — see
    #: `app.pricing.service.recompute_list_price`.
    price_formula: Mapped[str | None] = mapped_column(String(500), nullable=True)

    #: Only meaningful when ``stock_alert_mode`` is CUSTOM.  GENERAL reads
    #: the store threshold from notifications; DISABLED never alerts.
    min_stock: Mapped[Quantity]
    stock_alert_mode: Mapped[str] = mapped_column(
        String(10), default=StockAlertMode.GENERAL, server_default=StockAlertMode.GENERAL
    )
    track_lots: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    track_expiration: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    #: Los productos con historia se desactivan para conservar los documentos;
    #: un alta sin uso puede eliminarse desde catálogo.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    category: Mapped[ProductCategory | None] = relationship()
    pos_category: Mapped[PosCategory | None] = relationship()
    packages: Mapped[list[ProductPackage]] = relationship(
        back_populates="product", order_by="ProductPackage.factor", cascade="all, delete-orphan"
    )


class ProductPackage(IntPrimaryKeyMixin, TimestampMixin, Base):
    """A sellable presentation of a product ("BRIK", "CAJA 6", ...).

    ``factor`` converts this presentation to base units (rule 4): selling
    one unit of a ``factor=6`` package deducts 6 base units of stock.
    """

    __tablename__ = "product_packages"
    __table_args__ = (
        UniqueConstraint("product_id", "name", name="uq_product_packages_product_id_name"),
    )

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    factor: Mapped[Quantity]
    is_base: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    product: Mapped[Product] = relationship(back_populates="packages")
    barcodes: Mapped[list[ProductBarcode]] = relationship(
        back_populates="package", cascade="all, delete-orphan", order_by="ProductBarcode.id"
    )


class ProductBarcode(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "product_barcodes"

    package_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("product_packages.id"), index=True
    )
    barcode: Mapped[str] = mapped_column(String(64), unique=True)

    package: Mapped[ProductPackage] = relationship(back_populates="barcodes")


class EntityImage(IntPrimaryKeyMixin, TimestampMixin, Base):
    """La foto de un producto o de una categoría.

    En su propia tabla, y no como columna de `products`/`product_categories`
    /`pos_categories`, por dos razones: los bytes no tienen por qué viajar
    en cada listado (un `SELECT products.*` con la imagen dentro traería
    megas para pintar una tabla de texto), y así una sola tabla sirve a los
    tres dueños en vez de repetir el mismo par de columnas tres veces.

    Guardadas en Postgres y no en disco a propósito: la copia de seguridad
    de la tienda es un `pg_dump` (scripts/backup-postgres.sh), así que las
    fotos entran en ella sin montar ni respaldar nada más. Las imágenes se
    reescalan en el navegador antes de subirlas (unas decenas de kB), que
    es lo que hace que esto salga a cuenta.

    `entity_type` es de una lista cerrada (`IMAGE_OWNERS`), no un texto
    libre: es lo que decide qué permiso hace falta para tocarla.

    `version` sube con cada reemplazo y viaja en la URL (`?v=`) para que el
    navegador no siga enseñando la foto vieja.
    """

    __tablename__ = "entity_images"
    __table_args__ = (UniqueConstraint("entity_type", "entity_id", name="uq_entity_images_owner"),)

    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[int] = mapped_column(BigInteger)
    content_type: Mapped[str] = mapped_column(String(64))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
