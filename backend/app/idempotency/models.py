"""Persistent idempotency records.

Records are intentionally retained indefinitely for now. OpenERP targets
small shops, and keeping the compact metadata row is safer than expiring a
key while a client may still be resolving an uncertain response. A future
housekeeping policy can be added if measured volume justifies it.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IntPrimaryKeyMixin


class IdempotencyRecord(IntPrimaryKeyMixin, Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (
        UniqueConstraint(
            "operation",
            "idempotency_key",
            name="uq_idempotency_records_operation_key",
        ),
    )

    operation: Mapped[str] = mapped_column(String(50))
    idempotency_key: Mapped[str] = mapped_column(String(200))
    request_fingerprint: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[int] = mapped_column(BigInteger)
    #: Identifier returned by operations whose result is not the aggregate
    #: named by ``resource_id`` (for example, a receipt created for a
    #: purchase order).  Checkout and state transitions return their root
    #: aggregate and therefore leave this null.
    result_resource_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    actor_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
