"""The minimal persistent identity of a physical POS register."""

from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin
from app.inventory.models import Warehouse


class PosTerminal(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "pos_terminals"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "name", name="uq_pos_terminals_warehouse_id_name"),
    )

    name: Mapped[str] = mapped_column(String(100))
    warehouse_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("warehouses.id", ondelete="RESTRICT"), index=True
    )
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")

    warehouse: Mapped[Warehouse] = relationship()
