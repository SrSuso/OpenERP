"""Sales and their lines.

Phase 11 only ever drives a sale through ``DRAFT -> CANCELLED``; reaching
``COMPLETED`` is exclusively phase 13's job, once payments exist — recording
a payment there is what actually moves stock (via
``app.inventory.service.record_movement``/``app.lots.service`` FEFO
consumption) and closes the sale, atomically with the payment itself (rule
5). The status enum is defined in full now so phase 13 has nothing to
migrate — only behaviour to add, exactly like ``PurchaseOrderStatus`` did
for phase 9.

Every line snapshots the economics it was rung up at (rule 6/7: a later
price or tax change must never reshape a sale already on the ticket) —
``unit_price``/``tax_rate`` are copied from the product at the moment the
line is added, never re-read from it afterwards.
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


class Sale(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sales"

    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"), index=True)
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("locations.id"))
    status: Mapped[str] = mapped_column(
        String(20), default=SaleStatus.DRAFT, server_default=SaleStatus.DRAFT
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

    #: Price snapshot, per base unit — copied from ``Product.list_price`` at
    #: the moment the line was added, never recomputed from it afterwards
    #: (rule 7).
    unit_price: Mapped[Money]
    tax_rate: Mapped[Decimal] = mapped_column(numeric(), default=Decimal(0))
    discount_rate: Mapped[Decimal] = mapped_column(numeric(), default=Decimal(0))

    sale: Mapped[Sale] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()
    package: Mapped[ProductPackage] = relationship()
