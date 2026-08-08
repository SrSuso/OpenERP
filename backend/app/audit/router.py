"""Read-only access to the audit trail. Needs ``audit.read``."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.audit import service
from app.audit.models import AuditLog
from app.audit.schemas import AuditLogRead
from app.auth.dependencies import SessionDep
from app.rbac.dependencies import require_permission
from app.rbac.permissions import AUDIT_READ

router = APIRouter(tags=["audit"], dependencies=[Depends(require_permission(AUDIT_READ))])


def _to_read(entry: AuditLog) -> AuditLogRead:
    return AuditLogRead(
        id=entry.id,
        user_id=entry.user_id,
        action=entry.action,
        entity_type=entry.entity_type,
        entity_id=entry.entity_id,
        before_data=entry.before_data,
        after_data=entry.after_data,
        request_id=entry.request_id,
        ip=entry.ip,
        created_at=entry.created_at,
    )


@router.get("/audit-log", response_model=list[AuditLogRead])
async def list_audit_log(
    session: SessionDep,
    entity_type: Annotated[str | None, Query()] = None,
    entity_id: Annotated[int | None, Query()] = None,
    user_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AuditLogRead]:
    entries = await service.list_entries(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        limit=limit,
        offset=offset,
    )
    return [_to_read(e) for e in entries]
