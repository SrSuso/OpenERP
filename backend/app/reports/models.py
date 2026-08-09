"""A saved report configuration: which subject, dimensions, metrics and
filters to run — never the query itself (see ``app.reports.rules`` for why:
rule 13, a saved definition only ever replays a combination from the same
fixed whitelist, it cannot smuggle SQL through).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin


class ReportDefinition(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "report_definitions"

    name: Mapped[str] = mapped_column(String(150))
    #: One of ``app.reports.rules.ReportSubject``.
    subject: Mapped[str] = mapped_column(String(30))
    dimensions: Mapped[list[str]] = mapped_column(JSONB, default=list)
    metrics: Mapped[list[str]] = mapped_column(JSONB, default=list)
    filters: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    #: Nullable: the user who saved it may since be deactivated (rule 14).
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )
