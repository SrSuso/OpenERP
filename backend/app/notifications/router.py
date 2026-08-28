"""Public V2 API for active alerts and their store-facing settings."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep
from app.notifications import service
from app.notifications.schemas import (
    ActiveAlertRead,
    ExpirationGeneralUpdate,
    NotificationSettingsRead,
    ProductExpirationUpdate,
    StockGeneralUpdate,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import NOTIFICATION_MANAGE, NOTIFICATION_READ

router = APIRouter(tags=["notifications"])

_require_read = Depends(require_permission(NOTIFICATION_READ))
_require_manage = Depends(require_permission(NOTIFICATION_MANAGE))


@router.get(
    "/notification-settings",
    response_model=NotificationSettingsRead,
    dependencies=[_require_read],
)
async def get_notification_settings(session: SessionDep) -> NotificationSettingsRead:
    return await service.get_notification_settings(session)


@router.put(
    "/notification-settings/stock",
    response_model=NotificationSettingsRead,
    dependencies=[_require_manage],
)
async def update_general_stock(
    payload: StockGeneralUpdate, session: SessionDep
) -> NotificationSettingsRead:
    return await service.update_general_stock(session, payload)


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


@router.get("/alerts", response_model=list[ActiveAlertRead], dependencies=[_require_read])
async def list_active_alerts(session: SessionDep) -> list[ActiveAlertRead]:
    return await service.list_active_alerts(session)
