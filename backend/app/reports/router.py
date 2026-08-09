"""Report endpoints. Running (ad hoc or a saved definition) needs
``report.read``; saving/deleting a definition needs ``report.manage``."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep
from app.rbac.dependencies import require_permission
from app.rbac.permissions import REPORT_MANAGE, REPORT_READ
from app.reports import service
from app.reports.models import ReportDefinition
from app.reports.schemas import (
    ReportDefinitionCreate,
    ReportDefinitionRead,
    ReportRunRequest,
    ReportRunResult,
    ReportSubjectInfo,
)

router = APIRouter(tags=["reports"])

_require_read = Depends(require_permission(REPORT_READ))
_require_manage = Depends(require_permission(REPORT_MANAGE))


def _definition_to_read(definition: ReportDefinition) -> ReportDefinitionRead:
    return ReportDefinitionRead(
        id=definition.id,
        name=definition.name,
        subject=definition.subject,
        dimensions=definition.dimensions,
        metrics=definition.metrics,
        filters=definition.filters,
        created_at=definition.created_at,
    )


@router.get(
    "/report-subjects", response_model=list[ReportSubjectInfo], dependencies=[_require_read]
)
async def list_subjects() -> list[ReportSubjectInfo]:
    return service.list_subjects()


@router.post("/reports/run", response_model=ReportRunResult, dependencies=[_require_read])
async def run_report(payload: ReportRunRequest, session: SessionDep) -> ReportRunResult:
    return await service.run_report(
        session, payload.subject, payload.dimensions, payload.metrics, payload.filters
    )


@router.get(
    "/report-definitions",
    response_model=list[ReportDefinitionRead],
    dependencies=[_require_read],
)
async def list_definitions(session: SessionDep) -> list[ReportDefinitionRead]:
    return [_definition_to_read(d) for d in await service.list_definitions(session)]


@router.post(
    "/report-definitions",
    response_model=ReportDefinitionRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_definition(
    payload: ReportDefinitionCreate, session: SessionDep
) -> ReportDefinitionRead:
    return _definition_to_read(await service.create_definition(session, payload))


@router.post(
    "/report-definitions/{definition_id}/run",
    response_model=ReportRunResult,
    dependencies=[_require_read],
)
async def run_definition(definition_id: int, session: SessionDep) -> ReportRunResult:
    return await service.run_definition(session, definition_id)


@router.delete(
    "/report-definitions/{definition_id}", status_code=204, dependencies=[_require_manage]
)
async def delete_definition(definition_id: int, session: SessionDep) -> None:
    await service.delete_definition(session, definition_id)
