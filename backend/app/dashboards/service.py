"""Dashboard/widget CRUD, plus running a widget's metric on demand."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.core.context import get_user_id
from app.core.errors import NotFoundError
from app.dashboards import metrics
from app.dashboards.models import Dashboard, DashboardWidget
from app.dashboards.schemas import DashboardCreate, DashboardWidgetCreate

_DASHBOARD_OPTIONS = (selectinload(Dashboard.widgets),)


async def get_dashboard(session: AsyncSession, dashboard_id: int) -> Dashboard:
    stmt = (
        select(Dashboard)
        .where(Dashboard.id == dashboard_id)
        .options(*_DASHBOARD_OPTIONS)
        .execution_options(populate_existing=True)
    )
    dashboard = (await session.execute(stmt)).scalar_one_or_none()
    if dashboard is None:
        raise NotFoundError(f"Dashboard {dashboard_id} not found.")
    return dashboard


async def list_dashboards(session: AsyncSession) -> list[Dashboard]:
    stmt = select(Dashboard).options(*_DASHBOARD_OPTIONS).order_by(Dashboard.name)
    return list((await session.execute(stmt)).scalars())


async def create_dashboard(session: AsyncSession, payload: DashboardCreate) -> Dashboard:
    dashboard = Dashboard(name=payload.name, owner_user_id=get_user_id())
    session.add(dashboard)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="dashboard",
        entity_id=dashboard.id,
        after={"name": dashboard.name},
    )
    return await get_dashboard(session, dashboard.id)


async def add_widget(
    session: AsyncSession, dashboard_id: int, payload: DashboardWidgetCreate
) -> Dashboard:
    await get_dashboard(session, dashboard_id)  # 404 if the dashboard doesn't exist
    widget = DashboardWidget(
        dashboard_id=dashboard_id,
        metric=payload.metric,
        title=payload.title,
        params=payload.params,
        chart_type=payload.chart_type,
        display_order=payload.display_order,
    )
    session.add(widget)
    await session.flush()
    await audit.record(
        session,
        action="widget_added",
        entity_type="dashboard",
        entity_id=dashboard_id,
        after={"metric": payload.metric, "title": payload.title},
    )
    return await get_dashboard(session, dashboard_id)


async def remove_widget(session: AsyncSession, dashboard_id: int, widget_id: int) -> Dashboard:
    dashboard = await get_dashboard(session, dashboard_id)
    widget = next((w for w in dashboard.widgets if w.id == widget_id), None)
    if widget is None:
        raise NotFoundError(f"Widget {widget_id} not found on dashboard {dashboard_id}.")

    await session.delete(widget)
    await session.flush()
    await audit.record(
        session,
        action="widget_removed",
        entity_type="dashboard",
        entity_id=dashboard_id,
        before={"widget_id": widget_id},
    )
    return await get_dashboard(session, dashboard_id)


async def get_widget_data(session: AsyncSession, dashboard_id: int, widget_id: int) -> Any:
    dashboard = await get_dashboard(session, dashboard_id)
    widget = next((w for w in dashboard.widgets if w.id == widget_id), None)
    if widget is None:
        raise NotFoundError(f"Widget {widget_id} not found on dashboard {dashboard_id}.")
    # Never stale, never cached: rule 13 also means a dashboard reflects
    # the ledger as of right now, not a snapshot that could quietly drift.
    return await metrics.run_metric(session, metrics.MetricKey(widget.metric), widget.params)
