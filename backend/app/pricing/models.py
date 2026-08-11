"""Price history, taxes, and the store-wide pricing formula.

``ProductPriceHistory`` is append-only, same philosophy as ``app.audit``:
one row per price change, never updated or deleted (rule 7 — changing a
product's current price must never rewrite what its price *was*). No
``updated_at``.

``Tax``/``category_taxes``/``product_taxes`` and ``PricingSettings`` are
what actually compute a product's list price, added after the 22-phase
plan closed, at the user's request: a product applies **one** tax at most
(two would add up to a rate that doesn't exist; the recargo de
equivalencia travels inside the tax itself, see ``Tax.surcharge_rate``),
and both tax and margin can be set on a
``ProductCategory`` as a default that a product's own explicit value (if
it has one) overrides — see ``app.pricing.service.effective_tax_rate``/
``effective_margin_rate``, the only place that resolves that priority.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

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
from app.db.types import Money, Rate, numeric


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
    """A named tax ("IVA general 21%"), managed on its own — never typed
    as a raw number on a product. Assigned to products/categories via the
    association tables below, one at most on each: those tables stay
    many-to-many because rows created before that rule existed have to
    remain readable."""

    __tablename__ = "taxes"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    rate: Mapped[Rate]
    #: *Recargo de equivalencia* that goes with this rate (5.2 with IVA
    #: 21, 1.4 with IVA 10, 0.5 with IVA 4, 0 for a shop not under the
    #: regime). Deliberately a column on the tax rather than a `Tax` of
    #: its own: the two always travel together, and they are not
    #: interchangeable — the surcharge is a *purchase cost* the shop pays
    #: its supplier and never charges the customer, so it feeds the
    #: pricing formula's ``surcharge_rate`` variable (see
    #: `app.pricing.service.effective_surcharge_rate`) and is deliberately
    #: absent from `SaleLine.tax_rate` and from the receipt.
    surcharge_rate: Mapped[Decimal] = mapped_column(numeric(), default=0, server_default="0")
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
    #: ``False`` (the historical behaviour): a `SaleLine.unit_price` is net
    #: of tax, and every total (checkout amount, ticket, dashboards,
    #: reports) adds tax on top of it. ``True``: `unit_price` is already
    #: the final, tax-included price the customer pays — the same total is
    #: still charged, but tax is *extracted* from it instead of added, so a
    #: product's shelf price never silently changes when this flips.
    #: `app.sales.service.compute_amounts` is the one place that branches
    #: on this — everything that shows money for a sale (checkout,
    #: tickets, `app.returns`, `app.dashboards`, `app.reports`) either
    #: calls it directly or mirrors it exactly, so flipping this is
    #: consistent everywhere at once, not just cosmetic on one screen.
    prices_include_tax: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
