"""Append-only audit trail.

``record`` is the only way any module writes here, and it always runs inside
the caller's existing transaction — a mutation and the row describing it
commit (or roll back) together, so the trail can never show an action that
didn't actually happen, or omit one that did.

Deliberately no ``update``/``delete``: the audit log is append-only *from
the application*, and the absence of such a function is how that rule is
enforced in code, not just documented.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditLog
from app.core.context import get_client_ip, get_request_id, get_user_id


async def record(
    session: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id: int | None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            user_id=get_user_id(),
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before_data=before,
            after_data=after,
            request_id=get_request_id(),
            ip=get_client_ip(),
        )
    )
    await session.flush()


async def list_entries(
    session: AsyncSession,
    *,
    entity_type: str | None = None,
    entity_id: int | None = None,
    user_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[AuditLog]:
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    if entity_type is not None:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if user_id is not None:
        stmt = stmt.where(AuditLog.user_id == user_id)
    stmt = stmt.limit(limit).offset(offset)
    return list((await session.execute(stmt)).scalars())
