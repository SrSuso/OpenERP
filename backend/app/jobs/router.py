"""Outbox endpoints — observability and a manual trigger, ``job.read``/
``job.manage`` (``ADMIN``/``MANAGER`` only). The real, periodic sender is
``app.jobs.worker``, a separate process; nothing here is on any request
path that also touches a sale (rule 10)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import SessionDep
from app.core.config import get_settings
from app.jobs import service
from app.jobs.presenters import message_to_read as _to_read
from app.jobs.schemas import OutboxMessageRead, ProcessOutboxResult
from app.rbac.dependencies import require_permission
from app.rbac.permissions import JOB_MANAGE, JOB_READ

router = APIRouter(tags=["jobs"])

_require_read = Depends(require_permission(JOB_READ))
_require_manage = Depends(require_permission(JOB_MANAGE))


@router.get("/outbox", response_model=list[OutboxMessageRead], dependencies=[_require_read])
async def list_outbox(
    session: SessionDep, status: Annotated[str | None, Query()] = None
) -> list[OutboxMessageRead]:
    return [_to_read(m) for m in await service.list_messages(session, status=status)]


@router.post("/outbox/run", response_model=ProcessOutboxResult, dependencies=[_require_manage])
async def run_outbox(session: SessionDep) -> ProcessOutboxResult:
    """Processes one batch now, synchronously — a debug/ops action, not
    something any sale/checkout flow ever calls. The real cadence is
    ``app.jobs.worker`` running as its own process."""
    processed = await service.process_batch(session, get_settings())
    return ProcessOutboxResult(processed=processed)
