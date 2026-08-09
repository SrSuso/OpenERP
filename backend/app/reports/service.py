"""Report builder service: subject metadata, running a report (ad hoc or
saved), and CRUD for saved ``ReportDefinition`` rows."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.core.context import get_user_id
from app.core.errors import NotFoundError
from app.reports import rules
from app.reports.models import ReportDefinition
from app.reports.rules import ReportFilters, ReportSubject
from app.reports.schemas import (
    ReportDefinitionCreate,
    ReportFieldInfo,
    ReportRunResult,
    ReportSubjectInfo,
)


def list_subjects() -> list[ReportSubjectInfo]:
    return [
        ReportSubjectInfo(
            subject=subject,
            label=subject_def.label,
            dimensions=[
                ReportFieldInfo(key=key, label=field_def.label)
                for key, field_def in subject_def.dimensions.items()
            ],
            metrics=[
                ReportFieldInfo(key=key, label=field_def.label)
                for key, field_def in subject_def.metrics.items()
            ],
            filter_keys=subject_def.filter_keys,
        )
        for subject, subject_def in rules.SUBJECTS.items()
    ]


async def run_report(
    session: AsyncSession,
    subject: ReportSubject,
    dimensions: list[str],
    metrics: list[str],
    filters: ReportFilters,
) -> ReportRunResult:
    columns, rows = await rules.run_report(session, subject, dimensions, metrics, filters)
    return ReportRunResult(columns=columns, rows=rows)


async def list_definitions(session: AsyncSession) -> list[ReportDefinition]:
    stmt = select(ReportDefinition).order_by(ReportDefinition.name)
    return list((await session.execute(stmt)).scalars())


async def get_definition(session: AsyncSession, definition_id: int) -> ReportDefinition:
    definition = await session.get(ReportDefinition, definition_id)
    if definition is None:
        raise NotFoundError(f"Report definition {definition_id} not found.")
    return definition


async def create_definition(
    session: AsyncSession, payload: ReportDefinitionCreate
) -> ReportDefinition:
    # Rejects an unknown dimension/metric key up front, same validation
    # run_report does — a saved definition should never be able to save
    # something it could not also run.
    await rules.run_report(
        session, payload.subject, payload.dimensions, payload.metrics, payload.filters
    )

    definition = ReportDefinition(
        name=payload.name,
        subject=payload.subject,
        dimensions=payload.dimensions,
        metrics=payload.metrics,
        filters=payload.filters.model_dump(mode="json"),
        created_by_user_id=get_user_id(),
    )
    session.add(definition)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="report_definition",
        entity_id=definition.id,
        after={"name": definition.name, "subject": definition.subject},
    )
    return definition


async def run_definition(session: AsyncSession, definition_id: int) -> ReportRunResult:
    definition = await get_definition(session, definition_id)
    filters = ReportFilters.model_validate(definition.filters)
    return await run_report(
        session,
        ReportSubject(definition.subject),
        definition.dimensions,
        definition.metrics,
        filters,
    )


async def delete_definition(session: AsyncSession, definition_id: int) -> None:
    definition = await get_definition(session, definition_id)
    await session.delete(definition)
    await session.flush()
    await audit.record(
        session,
        action="deleted",
        entity_type="report_definition",
        entity_id=definition_id,
        before={"name": definition.name, "subject": definition.subject},
    )
