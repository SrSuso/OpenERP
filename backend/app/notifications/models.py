"""Notification rules and the incidents they detect, deduplicated.

A rule watches one fixed condition (``RuleType`` — same whitelist spirit as
``app.dashboards.metrics.MetricKey``, rule 13's philosophy applied here
too: a rule can only ever point at one of a small set of hand-written,
parameterised detector queries, never arbitrary logic). Evaluating the
rules (``app.notifications.service.evaluate_rules``) is what actually
finds/creates/resolves ``Incident`` rows — nothing here runs on a
schedule yet; wiring that up against the transactional outbox is phase
18's job, anticipated by ``app.jobs`` since phase 0.

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
    #: One of ``app.notifications.rules.RuleType``.
    rule_type: Mapped[str] = mapped_column(String(30))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    #: Cuánto corre. Sólo cambia cómo se presenta el aviso (color, y si
    #: parpadea en el menú) — ver `app.notifications.rules.Severity`.
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
