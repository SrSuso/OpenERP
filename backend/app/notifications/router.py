"""Notification endpoints. Both rules and incidents need
``notification.read``/``notification.manage``, ``ADMIN``/``MANAGER`` only
— same criterion as dashboards, purchasing/receiving: back-office, not the
cashier's job."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import SessionDep
from app.notifications import service
from app.notifications.presenters import incident_to_read as _incident_to_read
from app.notifications.presenters import rule_to_read as _rule_to_read
from app.notifications.schemas import (
    ConditionCatalogueRead,
    IncidentRead,
    NotificationRuleCreate,
    NotificationRuleRead,
    NotificationRuleUpdate,
    condition_catalogue,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import NOTIFICATION_MANAGE, NOTIFICATION_READ

router = APIRouter(tags=["notifications"])

_require_read = Depends(require_permission(NOTIFICATION_READ))
_require_manage = Depends(require_permission(NOTIFICATION_MANAGE))


@router.get(
    "/notification-fields", response_model=ConditionCatalogueRead, dependencies=[_require_read]
)
async def list_condition_fields() -> ConditionCatalogueRead:
    """Sobre qué se puede escribir una regla, con qué campos y qué
    comparadores — el panel construye el formulario a partir de esto, sin
    llevar escrita ni una clave (ver `app.notifications.conditions`)."""
    return condition_catalogue()


@router.get(
    "/notification-rules", response_model=list[NotificationRuleRead], dependencies=[_require_read]
)
async def list_rules(session: SessionDep) -> list[NotificationRuleRead]:
    return [_rule_to_read(r) for r in await service.list_rules(session)]


@router.post(
    "/notification-rules",
    response_model=NotificationRuleRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_rule(payload: NotificationRuleCreate, session: SessionDep) -> NotificationRuleRead:
    return _rule_to_read(await service.create_rule(session, payload))


@router.patch(
    "/notification-rules/{rule_id}",
    response_model=NotificationRuleRead,
    dependencies=[_require_manage],
)
async def update_rule(
    rule_id: int, payload: NotificationRuleUpdate, session: SessionDep
) -> NotificationRuleRead:
    return _rule_to_read(await service.update_rule(session, rule_id, payload))


@router.post(
    "/notifications/evaluate",
    response_model=list[IncidentRead],
    dependencies=[_require_manage],
)
async def evaluate(session: SessionDep) -> list[IncidentRead]:
    """Runs every active rule now. Manually triggered until phase 18 wires
    this up to a scheduled worker — see the module docstring."""
    return [_incident_to_read(i) for i in await service.evaluate_rules(session)]


@router.get("/incidents", response_model=list[IncidentRead], dependencies=[_require_read])
async def list_incidents(
    session: SessionDep,
    status: Annotated[str | None, Query()] = None,
    rule_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[IncidentRead]:
    incidents = await service.list_incidents(
        session, status=status, rule_id=rule_id, limit=limit, offset=offset
    )
    return [_incident_to_read(i) for i in incidents]


@router.get("/incidents/{incident_id}", response_model=IncidentRead, dependencies=[_require_read])
async def get_incident(incident_id: int, session: SessionDep) -> IncidentRead:
    return _incident_to_read(await service.get_incident(session, incident_id))


@router.post(
    "/incidents/{incident_id}/resolve",
    response_model=IncidentRead,
    dependencies=[_require_manage],
)
async def resolve_incident(incident_id: int, session: SessionDep) -> IncidentRead:
    return _incident_to_read(await service.resolve_incident(session, incident_id))
