"""System settings: a singleton row of admin-editable overrides on top of
`app.core.config.Settings` (env/`.env`) — see the model's docstring for why
every column is nullable.

`get_effective_settings` is what everything that actually talks to SMTP or
looks up a notification recipient calls (`app.jobs.mailer` via
`app.jobs.worker`/`app.jobs.router`, `app.notifications.service`) — a
change saved through `update_settings` takes effect on the very next
outbox poll or rule evaluation, no redeploy needed.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.settings.models import SystemSettings
from app.settings.schemas import SystemSettingsRead, SystemSettingsUpdate

#: Only one row ever exists — see the model's docstring.
_ROW_ID = 1

_OVERRIDABLE_FIELDS = (
    "smtp_host",
    "smtp_port",
    "smtp_use_tls",
    "smtp_username",
    "smtp_password",
    "smtp_from_email",
    "notification_recipient_email",
)


async def _get_row(session: AsyncSession) -> SystemSettings | None:
    return await session.get(SystemSettings, _ROW_ID)


async def _get_or_create_row(session: AsyncSession) -> SystemSettings:
    row = await _get_row(session)
    if row is None:
        row = SystemSettings(id=_ROW_ID)
        session.add(row)
        await session.flush()
        # `created_at`/`updated_at` are server defaults (`func.now()`) —
        # unloaded until refreshed, and a later plain attribute access
        # (`row.updated_at` in `get_settings_read`) would otherwise try an
        # implicit lazy load outside of an ``await`` (MissingGreenlet).
        await session.refresh(row)
    return row


async def get_effective_settings(session: AsyncSession, base: Settings | None = None) -> Settings:
    """`base` (env config, `get_settings()` by default) with any non-NULL
    column from the singleton row applied on top."""
    base = base or get_settings()
    row = await _get_row(session)
    if row is None:
        return base
    overrides = {
        field: value for field in _OVERRIDABLE_FIELDS if (value := getattr(row, field)) is not None
    }
    return base.model_copy(update=overrides) if overrides else base


async def get_settings_read(session: AsyncSession) -> SystemSettingsRead:
    effective = await get_effective_settings(session)
    row = await _get_row(session)
    return SystemSettingsRead(
        smtp_host=effective.smtp_host,
        smtp_port=effective.smtp_port,
        smtp_use_tls=effective.smtp_use_tls,
        smtp_username=effective.smtp_username,
        smtp_password_set=bool(row and row.smtp_password),
        smtp_from_email=effective.smtp_from_email,
        notification_recipient_email=effective.notification_recipient_email,
        updated_at=row.updated_at if row is not None else None,
    )


async def update_settings(
    session: AsyncSession, payload: SystemSettingsUpdate
) -> SystemSettingsRead:
    row = await _get_or_create_row(session)
    fields = payload.model_fields_set
    if "smtp_host" in fields:
        row.smtp_host = payload.smtp_host or None
    if "smtp_port" in fields:
        row.smtp_port = payload.smtp_port
    if "smtp_use_tls" in fields:
        row.smtp_use_tls = payload.smtp_use_tls
    if "smtp_username" in fields:
        row.smtp_username = payload.smtp_username or None
    if "smtp_password" in fields:
        row.smtp_password = payload.smtp_password or None
    if "smtp_from_email" in fields:
        row.smtp_from_email = payload.smtp_from_email or None
    if "notification_recipient_email" in fields:
        row.notification_recipient_email = payload.notification_recipient_email or None
    await session.flush()
    # `updated_at`'s `onupdate=func.now()` is computed server-side — reload
    # it so `get_settings_read` doesn't try an implicit lazy load outside
    # of an ``await`` (see the same reasoning in `_get_or_create_row`).
    await session.refresh(row)
    return await get_settings_read(session)
