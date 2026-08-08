"""Refunds and physical restocking against a completed sale.

Rule 9: a return line can refund money without putting stock back (a
damaged unit written off), put stock back without refunding (a goodwill
exchange), or both — ``is_economic``/``is_physical`` are independent flags,
never coupled to each other.

Only against a ``COMPLETED`` sale — nothing was ever fulfilled on a
``DRAFT``/``CANCELLED`` one, so there is nothing to return. A return line
reuses its original ``SaleLine``'s already-snapshotted
``unit_price``/``tax_rate``/``discount_rate`` (rule 6/7) to compute the
refund rather than re-reading the product, and increments that line's own
``quantity_returned`` running total — same pattern as
``PurchaseOrderLine.quantity_received`` from phases 6/9 — so a line can
never be returned more than it sold.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.catalog.models import Product, ProductPackage
from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.db.types import Money, Quantity
from app.lots.models import Lot
from app.sales.models import Sale, SaleLine


class Return(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "returns"

    sale_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sales.id"), index=True)
    notes: Mapped[str] = mapped_column(String(2000), default="")
    #: Nullable: the user who processed it may since be deactivated (rule 14).
    processed_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )

    sale: Mapped[Sale] = relationship()
    lines: Mapped[list[ReturnLine]] = relationship(
        back_populates="return_", cascade="all, delete-orphan", order_by="ReturnLine.id"
    )


class ReturnLine(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "return_lines"

    return_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("returns.id"), index=True)
    sale_line_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sale_lines.id"), index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    package_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("product_packages.id"))
    #: Snapshots of the sale line's own package — a return is always
    #: denominated in the same presentation it was sold in.
    package_name: Mapped[str] = mapped_column(String(50))
    package_factor: Mapped[Quantity]

    quantity_packages: Mapped[Quantity]
    quantity_base: Mapped[Quantity]

    #: Independent per rule 9 — see the module docstring.
    is_economic: Mapped[bool] = mapped_column(default=True, server_default="true")
    is_physical: Mapped[bool] = mapped_column(default=True, server_default="true")
    #: 0 when ``is_economic`` is ``False``.
    refund_amount: Mapped[Money]
    #: Set only when ``is_physical`` and the product tracks lots — which
    #: lot the unit went back into (created if new, same as a goods
    #: receipt, phase 9).
    lot_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("lots.id"), nullable=True)
    #: Set only when ``is_physical`` — the ledger entry that put the unit
    #: back into ``stock_balance``.
    stock_movement_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("stock_movements.id"), nullable=True
    )

    return_: Mapped[Return] = relationship(back_populates="lines")
    sale_line: Mapped[SaleLine] = relationship()
    product: Mapped[Product] = relationship()
    package: Mapped[ProductPackage] = relationship()
    lot: Mapped[Lot | None] = relationship()
