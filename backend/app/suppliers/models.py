"""Suppliers and which products they sell (their own SKU and cost for it).

``purchase_orders``/``purchase_order_lines`` (phase 6) and
``goods_receipts``/``goods_receipt_lines`` (phase 9) reference these, but
live in their own modules.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.catalog.models import Product
from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.db.types import Money


class Supplier(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "suppliers"

    name: Mapped[str] = mapped_column(String(255))
    tax_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    address: Mapped[str] = mapped_column(String(500), default="")
    #: Rule 14: deactivated, never deleted, once it has any history
    #: (purchase orders reference it from phase 6 onward).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class ProductSupplier(IntPrimaryKeyMixin, TimestampMixin, Base):
    """One product, as sold by one supplier: their SKU and cost for it —
    independent from ``products.cost``, which is what *we* paid last."""

    __tablename__ = "product_suppliers"
    __table_args__ = (
        UniqueConstraint("product_id", "supplier_id", name="uq_product_suppliers_product_supplier"),
    )

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    supplier_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("suppliers.id"), index=True)
    supplier_sku: Mapped[str | None] = mapped_column(String(50), nullable=True)
    supplier_cost: Mapped[Money]
    is_preferred: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    product: Mapped[Product] = relationship()
    supplier: Mapped[Supplier] = relationship()
