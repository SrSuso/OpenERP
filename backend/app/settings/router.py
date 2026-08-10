"""System settings endpoints — `settings.read`/`settings.manage`.

Unlike most other `.manage` permissions in this app, MANAGER does not get
these by default (see the phase 21 migration): SMTP credentials are an
infrastructure secret, not a day-to-day store-management concern like
pricing or ticket templates. An ADMIN can still widen that through
`PATCH /roles/{id}/permissions` if a deployment wants it.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from app.audit import service as audit
from app.auth.dependencies import SessionDep
from app.core.errors import ValidationError
from app.jobs import mailer
from app.rbac.dependencies import require_permission
from app.rbac.permissions import SETTINGS_MANAGE, SETTINGS_READ
from app.settings import service
from app.settings.schemas import SmtpTestRequest, SystemSettingsRead, SystemSettingsUpdate

router = APIRouter(tags=["settings"])

_require_read = Depends(require_permission(SETTINGS_READ))
_require_manage = Depends(require_permission(SETTINGS_MANAGE))


@router.get("/settings/smtp", response_model=SystemSettingsRead, dependencies=[_require_read])
async def get_smtp_settings(session: SessionDep) -> SystemSettingsRead:
    return await service.get_settings_read(session)


@router.put("/settings/smtp", response_model=SystemSettingsRead, dependencies=[_require_manage])
async def update_smtp_settings(
    payload: SystemSettingsUpdate, session: SessionDep
) -> SystemSettingsRead:
    before = await service.get_settings_read(session)
    updated = await service.update_settings(session, payload)
    await audit.record(
        session,
        action="updated",
        entity_type="system_settings",
        entity_id=1,
        before=before.model_dump(mode="json"),
        after=updated.model_dump(mode="json"),
    )
    return updated


@router.post("/settings/smtp/test", status_code=204, dependencies=[_require_manage])
async def test_smtp_settings(payload: SmtpTestRequest, session: SessionDep) -> None:
    """Sends one real email right now, outside the outbox queue — a
    synchronous connectivity check for whatever is currently in the admin's
    form (see `SmtpTestRequest`), not something any business flow calls."""
    effective = await service.get_effective_settings(session)
    fields = payload.model_fields_set
    overrides: dict[str, object] = {
        field: getattr(payload, field)
        for field in (
            "smtp_host",
            "smtp_port",
            "smtp_use_tls",
            "smtp_username",
            "smtp_password",
            "smtp_from_email",
        )
        if field in fields
    }
    trial = effective.model_copy(update=overrides) if overrides else effective

    try:
        await asyncio.to_thread(
            mailer.send_email,
            trial,
            to_email=payload.to_email,
            subject="OpenERP: correo de prueba",
            body_text=(
                "Este es un correo de prueba enviado desde la configuración "
                "del servidor de correo de OpenERP. Si lo has recibido, la "
                "configuración funciona."
            ),
        )
    except Exception as exc:  # any SMTP failure (timeout, refused, auth, ...)
        raise ValidationError(f"No se ha podido enviar el correo de prueba: {exc}") from None
