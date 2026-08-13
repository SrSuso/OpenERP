"""Independent economic refunds and physical restocking.

A return line records two quantities because money and merchandise need not
move together.  Both are bounded independently by the original sale line.
``Refund`` is optional: a goodwill exchange can put goods back without any
economic effect and must not grow a fictitious zero-value refund row.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
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
    refund: Mapped[Refund | None] = relationship(
        back_populates="return_", cascade="all, delete-orphan", uselist=False
    )


class ReturnLine(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "return_lines"
    __table_args__ = (
        CheckConstraint(
            "refund_quantity_packages >= 0",
            name="refund_quantity_packages_non_negative",
        ),
        CheckConstraint(
            "refund_quantity_base >= 0",
            name="refund_quantity_base_non_negative",
        ),
        CheckConstraint(
            "stock_return_quantity_packages >= 0",
            name="stock_return_quantity_packages_non_negative",
        ),
        CheckConstraint(
            "stock_return_quantity_base >= 0",
            name="stock_return_quantity_base_non_negative",
        ),
        CheckConstraint(
            "refund_quantity_base > 0 OR stock_return_quantity_base > 0",
            name="has_economic_or_physical_quantity",
        ),
        CheckConstraint("refund_amount >= 0", name="refund_amount_non_negative"),
    )

    return_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("returns.id"), index=True)
    sale_line_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sale_lines.id"), index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    package_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("product_packages.id"))
    #: Snapshots of the sale line's own package — a return is always
    #: denominated in the same presentation it was sold in.
    package_name: Mapped[str] = mapped_column(String(50))
    package_factor: Mapped[Quantity]

    #: Quantity for which the customer receives the economic reversal.
    refund_quantity_packages: Mapped[Quantity]
    refund_quantity_base: Mapped[Quantity]
    #: Quantity of merchandise that physically re-enters this sale's stock
    #: location. Independent from the economic quantity above.
    stock_return_quantity_packages: Mapped[Quantity]
    stock_return_quantity_base: Mapped[Quantity]

    #: Economic value of this line, calculated from the original snapshots;
    #: zero for a physical-only return.
    refund_amount: Mapped[Money]
    #: Set only when physical quantity is positive and the product tracks lots — which
    #: lot the unit went back into (created if new, same as a goods
    #: receipt, phase 9).
    lot_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("lots.id"), nullable=True)
    #: Set only when physical quantity is positive for a stock-controlled
    #: product — the ledger entry that put the merchandise back.
    stock_movement_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("stock_movements.id"), nullable=True
    )

    return_: Mapped[Return] = relationship(back_populates="lines")
    sale_line: Mapped[SaleLine] = relationship()
    product: Mapped[Product] = relationship()
    package: Mapped[ProductPackage] = relationship()
    lot: Mapped[Lot | None] = relationship()


class RefundStatus(StrEnum):
    #: Creating a return means the operator confirms that cash was handed
    #: back or the external card terminal operation was already performed.
    COMPLETED = "COMPLETED"


class Refund(IntPrimaryKeyMixin, TimestampMixin, Base):
    """The realised economic effect of one return, absent for physical-only."""

    __tablename__ = "refunds"
    __table_args__ = (
        UniqueConstraint("return_id", name="uq_refunds_return_id"),
        CheckConstraint("amount >= 0", name="amount_non_negative"),
        CheckConstraint(
            "method IS NULL OR method IN ('CASH', 'CARD', 'OTHER')",
            name="supported_method",
        ),
        CheckConstraint("status = 'COMPLETED'", name="supported_status"),
        CheckConstraint(
            "status <> 'COMPLETED' OR completed_at IS NOT NULL",
            name="completed_has_timestamp",
        ),
    )

    return_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("returns.id"))
    amount: Mapped[Money]
    #: Nullable only for migrated history: the old model never recorded how
    #: the money was returned, and inventing a value would corrupt history.
    method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), default=RefundStatus.COMPLETED, server_default=RefundStatus.COMPLETED
    )
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    processed_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )

    return_: Mapped[Return] = relationship(back_populates="refund")
