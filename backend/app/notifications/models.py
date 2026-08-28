"""Internal settings and deduplicated incidents for the two V2 alerts.

``NotificationRule`` is deliberately not a public rule builder. It stores
the stock and expiration parameters consumed by the scheduled worker.

Deduplication is enforced by the database, not just application logic: at
most one ``OPEN`` incident may exist for a given ``(rule_id, subject_type,
subject_id)`` at a time (the partial unique index below) — re-detecting an
already-open incident only touches ``last_seen_at``, it never creates a
second one. A subject that stops matching its rule is auto-resolved the
next time the rule runs, not left open forever.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin


class NotificationRule(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notification_rules"

    name: Mapped[str] = mapped_column(String(100))
    #: LOW_STOCK or EXPIRING_LOT; both are internal implementation details.
    rule_type: Mapped[str] = mapped_column(String(30))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    #: Retained in the table to avoid a migration with no business benefit.
    #: V2 neither exposes nor configures it.
    severity: Mapped[str] = mapped_column(
        String(20), default="MEDIUM_LOW", server_default="MEDIUM_LOW"
    )
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")

    incidents: Mapped[list[Incident]] = relationship(back_populates="rule")


class Incident(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "incidents"
    __table_args__ = (
        Index(
            "uq_incidents_open_subject",
            "rule_id",
            "subject_type",
            "subject_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
        ),
    )

    rule_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("notification_rules.id"), index=True
    )
    #: What triggered it — "product" or "lot" today, more as rules grow.
    subject_type: Mapped[str] = mapped_column(String(30))
    subject_id: Mapped[int] = mapped_column(BigInteger)
    message: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="OPEN", server_default="OPEN")
    first_detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    #: Touched every time the rule re-detects this subject while the
    #: incident is still open — how a consumer tells "still ongoing" from
    #: "detected once, ages ago".
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    rule: Mapped[NotificationRule] = relationship(back_populates="incidents")
