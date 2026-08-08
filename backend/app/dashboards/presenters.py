"""ORM -> response-schema conversion for ``app.dashboards.router``."""

from __future__ import annotations

from app.dashboards.metrics import MetricKey
from app.dashboards.models import Dashboard, DashboardWidget
from app.dashboards.schemas import DashboardRead, DashboardWidgetRead


def widget_to_read(widget: DashboardWidget) -> DashboardWidgetRead:
    return DashboardWidgetRead(
        id=widget.id,
        dashboard_id=widget.dashboard_id,
        metric=MetricKey(widget.metric),
        title=widget.title,
        params=widget.params,
        chart_type=widget.chart_type,
        display_order=widget.display_order,
    )


def dashboard_to_read(dashboard: Dashboard) -> DashboardRead:
    return DashboardRead(
        id=dashboard.id,
        name=dashboard.name,
        owner_user_id=dashboard.owner_user_id,
        widgets=[widget_to_read(w) for w in dashboard.widgets],
    )
