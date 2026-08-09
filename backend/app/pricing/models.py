"""Price history, taxes, and the store-wide pricing formula.

``ProductPriceHistory`` is append-only, same philosophy as ``app.audit``:
one row per price change, never updated or deleted (rule 7 — changing a
product's current price must never rewrite what its price *was*). No
``updated_at``.

``Tax``/``category_taxes``/``product_taxes`` and ``PricingSettings`` are
what actually compute a product's list price, added after the 22-phase
plan closed, at the user's request: several taxes may apply to one
product at once (they stack additively — IVA + recargo de equivalencia,
for instance), and both taxes and margin can be set on a
``ProductCategory`` as a default that a product's own explicit value (if
it has one) overrides — see ``app.pricing.service.effective_tax_rate``/
``effective_margin_rate``, the only place that resolves that priority.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    String,
    Table,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.db.types import Money, Rate


class ProductPriceHistory(IntPrimaryKeyMixin, Base):
    __tablename__ = "product_price_history"

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    cost: Mapped[Money]
    tax_rate: Mapped[Rate]
    surcharge_rate: Mapped[Rate]
    margin_rate: Mapped[Rate]
    price_formula: Mapped[str | None] = mapped_column(String(500), nullable=True)
    list_price: Mapped[Money]
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Tax(IntPrimaryKeyMixin, TimestampMixin, Base):
    """A named tax/surcharge rate ("IVA general 21%", "Recargo de
    equivalencia 5.2%"), managed on its own — never typed as a raw number
    on a product. Assigned to products/categories via the association
    tables below; several can apply to the same product at once."""

    __tablename__ = "taxes"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    rate: Mapped[Rate]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


#: Plain `Table`s, not mapped classes — the relationship itself (on
#: `ProductCategory.taxes`/`Product.taxes`, app.catalog.models) is all
#: either side needs; nothing ever queries the link row for its own sake.
category_taxes = Table(
    "category_taxes",
    Base.metadata,
    Column("category_id", BigInteger, ForeignKey("product_categories.id"), primary_key=True),
    Column("tax_id", BigInteger, ForeignKey("taxes.id"), primary_key=True),
)

product_taxes = Table(
    "product_taxes",
    Base.metadata,
    Column("product_id", BigInteger, ForeignKey("products.id"), primary_key=True),
    Column("tax_id", BigInteger, ForeignKey("taxes.id"), primary_key=True),
)


class PricingSettings(IntPrimaryKeyMixin, TimestampMixin, Base):
    """Single row (id 1): the store-wide pricing formula used for every
    product that doesn't set its own `Product.price_formula` override.
    Same safe evaluator as a per-product formula
    (`app.pricing.formula`, rule 12 — never `eval()`), same variables
    (``cost``, ``tax_rate``, ``surcharge_rate``, ``margin_rate``) — just
    resolved from each product's *effective* values instead of always its
    own raw columns. Configured from the admin panel's Precios section."""

    __tablename__ = "pricing_settings"

    formula: Mapped[str] = mapped_column(Text)
