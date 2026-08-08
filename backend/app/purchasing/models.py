"""Purchase orders and their lines.

Every line snapshots the economics it was agreed at (rule 6: purchases and
sales keep historical snapshots) — later changing a product's cost or a
package's factor must never alter an order already placed.
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
from app.suppliers.models import Supplier


class PurchaseOrderStatus(StrEnum):
    DRAFT = "DRAFT"
    ORDERED = "ORDERED"
    PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED"
    RECEIVED = "RECEIVED"
    CANCELLED = "CANCELLED"


class PurchaseOrder(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "purchase_orders"

    supplier_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("suppliers.id"), index=True)
    status: Mapped[str] = mapped_column(
        String(20), default=PurchaseOrderStatus.DRAFT, server_default=PurchaseOrderStatus.DRAFT
    )
    notes: Mapped[str] = mapped_column(String(2000), default="")
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Nullable: the user who placed it may since have been deactivated
    #: (rule 14) without invalidating the historical order.
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )

    supplier: Mapped[Supplier] = relationship()
    lines: Mapped[list[PurchaseOrderLine]] = relationship(
        back_populates="purchase_order",
        cascade="all, delete-orphan",
        order_by="PurchaseOrderLine.id",
    )


class PurchaseOrderLine(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "purchase_order_lines"

    purchase_order_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("purchase_orders.id"), index=True
    )
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    package_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("product_packages.id"))
    #: Snapshots of the package as it was when the line was created — a
    #: later change to the package's name/factor must not reshape this line.
    package_name: Mapped[str] = mapped_column(String(50))
    package_factor: Mapped[Quantity]

    #: Ordered, in the package chosen above.
    quantity_packages: Mapped[Quantity]
    #: The same quantity converted to base units at the factor snapshotted
    #: above (rule 3) — what phase 7/9 actually move into the ledger.
    quantity_ordered: Mapped[Quantity]
    #: Filled in exclusively by phase 9's receiving flow.
    quantity_received: Mapped[Decimal] = mapped_column(
        numeric(), default=Decimal(0), server_default="0"
    )

    #: Cost snapshot, per unit of ``package`` (i.e. as quoted/invoiced) —
    #: never recomputed from the product's current cost.
    unit_cost: Mapped[Money]
    tax_rate: Mapped[Decimal] = mapped_column(numeric(), default=Decimal(0))
    discount_rate: Mapped[Decimal] = mapped_column(numeric(), default=Decimal(0))

    purchase_order: Mapped[PurchaseOrder] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()
    package: Mapped[ProductPackage] = relationship()
