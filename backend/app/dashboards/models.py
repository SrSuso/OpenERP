"""Configurable dashboards: a saved arrangement of widgets, each pointing
at one metric from the whitelist in ``app.dashboards.metrics`` — rule 13
("dashboards never run arbitrary SQL") is enforced by construction here,
not by sanitising input: a ``DashboardWidget`` can only ever name one of a
fixed set of Python query functions (``MetricKey``), never a string of SQL.
``params`` is free-form JSON at the storage layer, but every read and
write validates it against that specific metric's own Pydantic schema —
never interpolated into a query, only ever bound as typed filter values.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin


class Dashboard(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "dashboards"

    name: Mapped[str] = mapped_column(String(100))
    #: Legacy rows may be NULL, but they are private-orphaned rather than
    #: implicitly shared.  Deactivating a user does not delete it (rule 14),
    #: so owned dashboards keep a valid FK and can never change hands by
    #: accident.
    owner_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True, index=True
    )

    widgets: Mapped[list[DashboardWidget]] = relationship(
        back_populates="dashboard",
        cascade="all, delete-orphan",
        order_by="DashboardWidget.display_order",
    )


class DashboardWidget(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "dashboard_widgets"

    dashboard_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("dashboards.id"), index=True)
    #: One of ``app.dashboards.metrics.MetricKey`` — the only vocabulary a
    #: widget can speak.
    metric: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(100))
    #: Validated against the metric's own params schema on every write and
    #: re-validated on every read — see the module docstring.
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    #: How the frontend renders the metric's result: "kpi" | "line" |
    #: "bar" | "table". Purely presentational — never changes what gets
    #: queried.
    chart_type: Mapped[str] = mapped_column(String(20))
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    dashboard: Mapped[Dashboard] = relationship(back_populates="widgets")
