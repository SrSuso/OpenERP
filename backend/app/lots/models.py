"""Lots: a product's batches, with the dates FEFO (First Expired, First
Out) sorts by.

Where a lot's stock actually *is* lives in ``stock_balance``/
``stock_movements`` (``app.inventory``, extended by this phase to carry
``lot_id``) — this table only holds the lot's own identity and dates.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.catalog.models import Product
from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin


class Lot(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "lots"
    __table_args__ = (
        UniqueConstraint("product_id", "lot_number", name="uq_lots_product_id_lot_number"),
    )

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    lot_number: Mapped[str] = mapped_column(String(100))
    manufacturing_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: Nullable: not every lot-tracked product expires (e.g. batch/serial
    #: tracking for non-perishables). FEFO treats a lot with no expiration
    #: as consumed last, after every dated lot.
    expiration_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    supplier_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("suppliers.id"), nullable=True
    )
    purchase_order_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("purchase_orders.id"), nullable=True
    )

    product: Mapped[Product] = relationship()
