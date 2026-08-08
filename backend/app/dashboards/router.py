"""Dashboard endpoints. Both reading and managing dashboards/widgets need
``dashboard.read``/``dashboard.manage`` — analytics over sales/inventory
data is a back-office concern here, ``ADMIN``/``MANAGER`` only, same
criterion as purchasing/receiving (not the cashier-inclusive one sales
uses)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep
from app.dashboards import service
from app.dashboards.metrics import PARAMS_BY_METRIC
from app.dashboards.presenters import dashboard_to_read as _to_read
from app.dashboards.schemas import (
    DashboardCreate,
    DashboardRead,
    DashboardWidgetCreate,
    MetricDescriptorRead,
    WidgetDataRead,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import DASHBOARD_MANAGE, DASHBOARD_READ

router = APIRouter(tags=["dashboards"])

_require_read = Depends(require_permission(DASHBOARD_READ))
_require_manage = Depends(require_permission(DASHBOARD_MANAGE))


@router.get(
    "/dashboard-metrics", response_model=list[MetricDescriptorRead], dependencies=[_require_read]
)
async def list_metrics() -> list[MetricDescriptorRead]:
    return [
        MetricDescriptorRead(key=key, params_schema=params_model.model_json_schema())
        for key, params_model in PARAMS_BY_METRIC.items()
    ]


@router.get("/dashboards", response_model=list[DashboardRead], dependencies=[_require_read])
async def list_dashboards(session: SessionDep) -> list[DashboardRead]:
    return [_to_read(d) for d in await service.list_dashboards(session)]


@router.post(
    "/dashboards", response_model=DashboardRead, status_code=201, dependencies=[_require_manage]
)
async def create_dashboard(payload: DashboardCreate, session: SessionDep) -> DashboardRead:
    return _to_read(await service.create_dashboard(session, payload))


@router.get(
    "/dashboards/{dashboard_id}", response_model=DashboardRead, dependencies=[_require_read]
)
async def get_dashboard(dashboard_id: int, session: SessionDep) -> DashboardRead:
    return _to_read(await service.get_dashboard(session, dashboard_id))


@router.post(
    "/dashboards/{dashboard_id}/widgets",
    response_model=DashboardRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def add_widget(
    dashboard_id: int, payload: DashboardWidgetCreate, session: SessionDep
) -> DashboardRead:
    return _to_read(await service.add_widget(session, dashboard_id, payload))


@router.delete(
    "/dashboards/{dashboard_id}/widgets/{widget_id}",
    response_model=DashboardRead,
    dependencies=[_require_manage],
)
async def remove_widget(dashboard_id: int, widget_id: int, session: SessionDep) -> DashboardRead:
    return _to_read(await service.remove_widget(session, dashboard_id, widget_id))


@router.get(
    "/dashboards/{dashboard_id}/widgets/{widget_id}/data",
    response_model=WidgetDataRead,
    dependencies=[_require_read],
)
async def get_widget_data(dashboard_id: int, widget_id: int, session: SessionDep) -> WidgetDataRead:
    return WidgetDataRead(data=await service.get_widget_data(session, dashboard_id, widget_id))
