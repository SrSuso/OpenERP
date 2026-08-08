"""The transactional outbox.

Rule 10 (SMTP never blocks a sale) is enforced by construction: nothing in
a request handler ever opens an SMTP connection — a request only ever
``INSERT``s a ``PENDING`` row here, in the very same transaction as
whatever business event produced it (rule 5's philosophy applied to
messaging: the row and the event it describes commit or roll back
together). ``app.jobs.worker`` — a separate long-running process, not part
of the API — is the only thing that ever talks to SMTP, polling this table
with ``SELECT ... FOR UPDATE SKIP LOCKED`` so several worker instances
could run at once without ever double-sending the same message.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin


class OutboxMessage(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "outbox_messages"

    to_email: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(255))
    body_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", server_default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Free-form provenance for observability (e.g. "incident" / 42) — never
    #: read by the worker itself, only shown back through `GET /outbox`.
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
