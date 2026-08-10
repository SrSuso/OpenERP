"""Pydantic schemas for the admin-configurable system settings."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SystemSettingsRead(BaseModel):
    """The *effective* SMTP/notification configuration right now — DB
    overrides merged onto the environment's defaults (see
    `app.settings.service.get_effective_settings`), so an admin always sees
    what the outbox worker will actually use, not just what's been
    overridden. The raw password is never returned, only whether one is
    stored (`smtp_password_set`)."""

    smtp_host: str
    smtp_port: int
    smtp_use_tls: bool
    smtp_username: str | None
    smtp_password_set: bool
    smtp_from_email: str
    notification_recipient_email: str | None
    updated_at: datetime | None


class SystemSettingsUpdate(BaseModel):
    """Every field is independently optional, unlike e.g.
    `TicketTemplateRevise` — only the keys actually present in the request
    body are touched (`model_fields_set`, see
    `app.settings.service.update_settings`). An empty string clears that
    override back to the environment's default; omitting the key entirely
    leaves it exactly as it was."""

    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int | None = Field(default=None, ge=1, le=65535)
    smtp_use_tls: bool | None = None
    smtp_username: str | None = Field(default=None, max_length=255)
    smtp_password: str | None = Field(default=None, max_length=255)
    smtp_from_email: str | None = Field(default=None, max_length=255)
    notification_recipient_email: str | None = Field(default=None, max_length=255)


class SmtpTestRequest(BaseModel):
    """Send one real test email using the values currently in the admin's
    form (`app.settings.router.test_smtp_settings`) — any field omitted
    here falls back to whatever is already effective (saved override or
    environment default), so trying a new host without retyping an
    unrelated, already-saved password works as expected."""

    to_email: str = Field(min_length=3, max_length=255)
    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int | None = Field(default=None, ge=1, le=65535)
    smtp_use_tls: bool | None = None
    smtp_username: str | None = Field(default=None, max_length=255)
    smtp_password: str | None = Field(default=None, max_length=255)
    smtp_from_email: str | None = Field(default=None, max_length=255)
