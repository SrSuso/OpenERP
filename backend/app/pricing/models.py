"""Price history.

Append-only, same philosophy as ``app.audit``: one row per price change,
never updated or deleted (rule 7 — changing a product's current price must
never rewrite what its price *was*). No ``updated_at``.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IntPrimaryKeyMixin
from app.db.types import Money, Rate


class ProductPriceHistory(IntPrimaryKeyMixin, Base):
    __tablename__ = "product_price_history"

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), index=True)
    cost: Mapped[Money]
    tax_rate: Mapped[Rate]
    surcharge_rate: Mapped[Rate]
    margin_rate: Mapped[Rate]
    price_formula: Mapped[str | None] = mapped_column(String(500), nullable=True)
    list_price: Mapped[Money]
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
