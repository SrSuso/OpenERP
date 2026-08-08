"""The inventory ledger.

Rules 1-2: ``stock_movements`` is the historical origin of all inventory —
nothing, anywhere, ever writes a stock quantity directly. ``stock_balance``
is only an optimised projection of it, always kept in the same transaction
as the movement that changed it (rule 5), and always fully reconstructible
by summing ``stock_movements`` (enforced by
:func:`app.inventory.service.rebuild_stock_balance` and its test).

``lot_id`` (added by phase 8, once ``lots`` exists as a foreign key target)
is nullable — not every product tracks lots. A plain multi-column unique
constraint can't safely arbitrate upserts on a nullable column: Postgres
never considers two ``NULL``s equal, so two movements for the same
non-lot-tracked product/warehouse/location would each look "new" and
``stock_balance`` would grow a duplicate row per movement instead of one
kept in sync. ``StockBalance`` therefore carries *two* partial unique
indexes instead of one plain one — see the class docstring.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, UniqueConstraint, func, text
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
    #: Phase 8: which lot this quantity belongs to, for lot-tracked products.
    lot_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("lots.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class StockBalance(IntPrimaryKeyMixin, TimestampMixin, Base):
    """The only non-append-only table in this module — a projection,
    rebuildable at any time from ``stock_movements`` (rule 2).

    Two partial unique indexes stand in for the one conceptual key
    (product, warehouse, location, lot) because ``lot_id`` is nullable —
    see the module docstring. Exactly one of them applies to any given row;
    ``app.inventory.service._upsert_balance`` picks the matching one as the
    ``ON CONFLICT`` arbiter depending on whether ``lot_id`` is given.
    """

    __tablename__ = "stock_balance"

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"), index=True)
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("locations.id"), index=True)
    lot_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("lots.id"), nullable=True, index=True
    )
    quantity: Mapped[Quantity]

    __table_args__ = (
        Index(
            "uq_stock_balance_no_lot",
            "product_id",
            "warehouse_id",
            "location_id",
            unique=True,
            postgresql_where=text("lot_id IS NULL"),
        ),
        Index(
            "uq_stock_balance_with_lot",
            "product_id",
            "warehouse_id",
            "location_id",
            lot_id,
            unique=True,
            postgresql_where=text("lot_id IS NOT NULL"),
        ),
    )
