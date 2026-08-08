"""The audit log.

Append-only: this module (and every module built on it) never updates or
deletes a row here — see :mod:`app.audit.service`, which exposes ``record``
and ``list_entries`` and nothing else. No ``updated_at``, deliberately: a
row that could be updated wouldn't be an audit trail.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IntPrimaryKeyMixin


class AuditLog(IntPrimaryKeyMixin, Base):
    __tablename__ = "audit_log"

    # Nullable: a handful of actions (bootstrapping the first admin) happen
    # before any user session exists.
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(50))
    entity_type: Mapped[str] = mapped_column(String(50), index=True)
    entity_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    before_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    after_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
