"""Sales, their lines and payments.

Phase 11 only ever drove a sale through ``DRAFT -> CANCELLED``; reaching
``COMPLETED`` is phase 13's job (this module) — recording a payment is what
actually moves stock (via ``app.inventory.service.record_movement``/
``app.lots.service`` FEFO consumption) and closes the sale, atomically with
the payment itself (rule 5). See ``app.sales.service.checkout``.

Every line snapshots the economics it was rung up at (rule 6/7: a later
price or tax change must never reshape a sale already on the ticket) —
``unit_price``/``tax_rate`` are copied from the product at the moment the
line is added, never re-read from it afterwards.

``Payment`` rows are append-only too (same philosophy as ``audit_log``,
``product_price_history``): a till never edits or deletes a tender once
recorded, only ``app.returns`` (phase 14) can economically undo one, and
that is a new row of its own, not a mutation of this one.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.catalog.models import Product, ProductPackage
from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.db.types import Money, Quantity, numeric
from app.inventory.models import Location, Warehouse


class SaleStatus(StrEnum):
    DRAFT = "DRAFT"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class PaymentMethod(StrEnum):
    CASH = "CASH"
    CARD = "CARD"
    OTHER = "OTHER"


class Sale(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sales"

    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"), index=True)
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("locations.id"))
    # Indexed (phase 20): the POS "resume or open a draft" lookup and every
    # dashboard/report metric filter on this column, on a table that only
    # ever grows.
    status: Mapped[str] = mapped_column(
        String(20), default=SaleStatus.DRAFT, server_default=SaleStatus.DRAFT, index=True
    )
    notes: Mapped[str] = mapped_column(String(2000), default="")
    #: Nullable: the cashier who rang it up may since have been deactivated
    #: (rule 14) without invalidating the historical sale.
    cashier_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )
    #: Set exclusively by phase 13, once a payment completes the sale.
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    warehouse: Mapped[Warehouse] = relationship()
    location: Mapped[Location] = relationship()
    lines: Mapped[list[SaleLine]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", order_by="SaleLine.id"
    )
    payments: Mapped[list[Payment]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", order_by="Payment.id"
    )


class SaleLine(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sale_lines"

    sale_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sales.id"), index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    package_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("product_packages.id"))
    #: Snapshots of the package as it was when the line was rung up — a
    #: later change to the package's name/factor must not reshape this line.
    package_name: Mapped[str] = mapped_column(String(50))
    package_factor: Mapped[Quantity]

    #: Sold, in the package chosen above (what the cashier scanned/typed).
    quantity_packages: Mapped[Quantity]
    #: The same quantity converted to base units at the factor snapshotted
    #: above (rule 3) — what phase 13's checkout actually moves out of the
    #: ledger.
    quantity_base: Mapped[Quantity]
    #: Running total already given back through ``app.returns`` (phase 14)
    #: — same pattern as ``PurchaseOrderLine.quantity_received`` (phases
    #: 6/9). Never exceeds ``quantity_base``; a line can't be returned twice
    #: over.
    quantity_returned: Mapped[Quantity] = mapped_column(default=Decimal(0), server_default="0")

    #: Price snapshot, per base unit — copied from ``Product.list_price`` at
    #: the moment the line was added, never recomputed from it afterwards
    #: (rule 7).
    unit_price: Mapped[Money]
    tax_rate: Mapped[Decimal] = mapped_column(numeric(), default=Decimal(0))
    discount_rate: Mapped[Decimal] = mapped_column(numeric(), default=Decimal(0))

    sale: Mapped[Sale] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()
    package: Mapped[ProductPackage] = relationship()


class Payment(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "payments"

    sale_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sales.id"), index=True)
    method: Mapped[str] = mapped_column(String(20))
    #: What the customer actually tendered for this payment — may exceed
    #: what was still owed at the time (a cash tender bigger than the
    #: balance due), in which case ``checkout`` returns the excess as
    #: change rather than recording it here (rule 8: this is what was
    #: handed over, not what the till kept).
    amount: Mapped[Money]

    sale: Mapped[Sale] = relationship(back_populates="payments")
