"""Products, their presentations (packages) and barcodes.

Stock (from phase 7 onward) is always held in a product's base unit — rule
3. A package's ``factor`` is how many base units it is worth (rule 4); the
base presentation itself is just the package with ``factor == 1`` and
``is_base == True``, created automatically alongside the product so every
product always has exactly one.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.db.types import Money, Quantity, Rate, numeric


class ProductCategory(IntPrimaryKeyMixin, TimestampMixin, Base):
    """Independent from the POS-facing categories of phase 10 — a product's
    shelf category ("Lácteos") is not the same list as what a till button
    shows ("Ofertas")."""

    __tablename__ = "product_categories"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class Product(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "products"

    sku: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(String(2000), default="")
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("product_categories.id"), nullable=True, index=True
    )

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
    tax_rate: Mapped[Rate]
    # server_default (unlike the other Rate/Money columns): these two were
    # added in phase 4 to an already-shipped table, so existing rows need a
    # backfill value — the app itself always sends an explicit value on
    # every write from here on (ProductCreate defaults to 0, and every
    # later write goes through app.pricing).
    surcharge_rate: Mapped[Decimal] = mapped_column(numeric(), server_default="0")
    margin_rate: Mapped[Decimal] = mapped_column(numeric(), server_default="0")
    #: The pricing formula text; ``app.pricing.formula`` parses and
    #: evaluates it with a restricted AST walker (rule 12: never eval()).
    price_formula: Mapped[str | None] = mapped_column(String(500), nullable=True)

    min_stock: Mapped[Quantity]
    track_lots: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    track_expiration: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    #: Rule 14: deactivated, never deleted, once it has any history.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    category: Mapped[ProductCategory | None] = relationship()
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
