"""Notification endpoints. Both rules and incidents need
``notification.read``/``notification.manage``, ``ADMIN``/``MANAGER`` only
— same criterion as dashboards, purchasing/receiving: back-office, not the
cashier's job."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import SessionDep, SettingsDep
from app.notifications import service
from app.notifications.presenters import incident_to_read as _incident_to_read
from app.notifications.presenters import rule_to_read as _rule_to_read
from app.notifications.schemas import (
    ActiveAlertRead,
    ConditionCatalogueRead,
    ExpirationGeneralUpdate,
    IncidentRead,
    NotificationRuleCreate,
    NotificationRuleRead,
    NotificationRuleUpdate,
    NotificationSettingsRead,
    ProductExpirationUpdate,
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


@router.get(
    "/notification-settings",
    response_model=NotificationSettingsRead,
    dependencies=[_require_read],
)
async def get_notification_settings(session: SessionDep) -> NotificationSettingsRead:
    return await service.get_notification_settings(session)


@router.put(
    "/notification-settings/expiration/general",
    response_model=NotificationSettingsRead,
    dependencies=[_require_manage],
)
async def update_general_expiration(
    payload: ExpirationGeneralUpdate, session: SessionDep
) -> NotificationSettingsRead:
    return await service.update_general_expiration(session, payload)


@router.put(
    "/notification-settings/expiration/products/{product_id}",
    response_model=NotificationSettingsRead,
    dependencies=[_require_manage],
)
async def update_product_expiration(
    product_id: int, payload: ProductExpirationUpdate, session: SessionDep
) -> NotificationSettingsRead:
    return await service.update_product_expiration(session, product_id, payload)


@router.delete(
    "/notification-settings/expiration/products/{product_id}",
    response_model=NotificationSettingsRead,
    dependencies=[_require_manage],
)
async def remove_product_expiration(
    product_id: int, session: SessionDep
) -> NotificationSettingsRead:
    return await service.remove_product_expiration(session, product_id)


@router.post(
    "/notifications/evaluate",
    response_model=list[IncidentRead],
    dependencies=[_require_manage],
)
async def evaluate(session: SessionDep, settings: SettingsDep) -> list[IncidentRead]:
    """Compatibility/debug endpoint. Normal operation is worker-driven."""
    return [_incident_to_read(i) for i in await service.evaluate_rules(session, settings)]


@router.get("/alerts", response_model=list[ActiveAlertRead], dependencies=[_require_read])
async def list_active_alerts(session: SessionDep) -> list[ActiveAlertRead]:
    return await service.list_active_alerts(session)


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
