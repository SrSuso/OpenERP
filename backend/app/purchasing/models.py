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
from app.inventory.models import Location, Warehouse
from app.lots.models import Lot
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


class GoodsReceipt(IntPrimaryKeyMixin, TimestampMixin, Base):
    """Phase 9: a delivery physically arriving against a purchase order.

    Recording one is what actually moves stock (rule: a receipt increases
    inventory) — every line writes a real ``PURCHASE_RECEIPT`` movement via
    ``app.inventory.service.record_movement`` in the same transaction.
    """

    __tablename__ = "goods_receipts"

    purchase_order_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("purchase_orders.id"), index=True
    )
    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"))
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("locations.id"))
    notes: Mapped[str] = mapped_column(String(2000), default="")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )

    purchase_order: Mapped[PurchaseOrder] = relationship()
    warehouse: Mapped[Warehouse] = relationship()
    location: Mapped[Location] = relationship()
    lines: Mapped[list[GoodsReceiptLine]] = relationship(
        back_populates="goods_receipt", cascade="all, delete-orphan", order_by="GoodsReceiptLine.id"
    )


class GoodsReceiptLine(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "goods_receipt_lines"

    goods_receipt_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("goods_receipts.id"), index=True
    )
    purchase_order_line_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("purchase_order_lines.id"), index=True
    )
    #: Physically received, in the PO line's package — what the delivery
    #: note says, not necessarily what was ordered.
    quantity_packages: Mapped[Quantity]
    #: Nullable: only lot-tracked products (``products.track_lots``) get one.
    lot_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("lots.id"), nullable=True)
    #: Traceability to the ledger entry this line produced.
    stock_movement_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("stock_movements.id"), nullable=True
    )

    goods_receipt: Mapped[GoodsReceipt] = relationship(back_populates="lines")
    purchase_order_line: Mapped[PurchaseOrderLine] = relationship()
    lot: Mapped[Lot | None] = relationship()
