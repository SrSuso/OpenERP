"""The inventory ledger.

Rules 1-2: ``stock_movements`` is the historical origin of all inventory —
nothing, anywhere, ever writes a stock quantity directly. ``stock_balance``
is only an optimised projection of it, always kept in the same transaction
as the movement that changed it (rule 5), and always fully reconstructible
by summing ``stock_movements`` (enforced by
:func:`app.inventory.service.rebuild_stock_balance` and its test).

``lot_id`` is deliberately absent from ``stock_movements`` here — phase 8
adds it once ``lots`` exists to be a foreign key target; adding the column
before that would either have no table to reference or force phase 8 to
retrofit one that phase 7 got wrong.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.db.types import Money, Quantity


class MovementType(StrEnum):
    PURCHASE_RECEIPT = "PURCHASE_RECEIPT"
    SALE = "SALE"
    RETURN = "RETURN"
    ADJUSTMENT = "ADJUSTMENT"
    WASTE = "WASTE"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"


class Warehouse(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "warehouses"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")


class Location(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "locations"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "name", name="uq_locations_warehouse_id_name"),
    )

    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")

    warehouse: Mapped[Warehouse] = relationship()


class StockMovement(IntPrimaryKeyMixin, Base):
    """Append-only (rule 1): no ``updated_at``, and
    :mod:`app.inventory.service` exposes no update/delete for this table —
    a correction is always a *new* movement (rule: an ``ADJUSTMENT``), never
    an edit to one already written.
    """

    __tablename__ = "stock_movements"

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"), index=True)
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("locations.id"), index=True)
    #: Signed, in the product's base unit (rule 3): positive increases
    #: stock, negative decreases it.
    quantity: Mapped[Quantity]
    movement_type: Mapped[str] = mapped_column(String(20), index=True)
    #: What business event this movement is a side effect of — e.g.
    #: ``"purchase_order"``/the PO's id (phase 9), ``"sale"``/the sale's id
    #: (phase 11). Nullable: a manual adjustment has no such reference.
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    #: Snapshot, never recomputed — what this specific quantity was valued
    #: at when it moved (rule 6).
    unit_cost: Mapped[Money]
    #: Nullable: a system-driven movement (or one from before a user
    #: existed) has no acting user.
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class StockBalance(IntPrimaryKeyMixin, TimestampMixin, Base):
    """The only non-append-only table in this module — a projection,
    rebuildable at any time from ``stock_movements`` (rule 2)."""

    __tablename__ = "stock_balance"
    __table_args__ = (
        UniqueConstraint(
            "product_id",
            "warehouse_id",
            "location_id",
            name="uq_stock_balance_product_warehouse_location",
        ),
    )

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"), index=True)
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("locations.id"), index=True)
    quantity: Mapped[Quantity]
