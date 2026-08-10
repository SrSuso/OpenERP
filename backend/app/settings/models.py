"""Admin-configurable overrides for environment-based settings
(`app.core.config.Settings`) — currently just SMTP/outbox, the piece an
operator most often needs to change after go-live (rotating a relay
password, switching providers, pointing at a real mail server instead of
the dev Mailpit instance...) without a redeploy.

Singleton table: exactly one row, id 1, created lazily on the first write
(`app.settings.service._get_or_create_row`) — reading before that just
falls back to the environment's own values. Every column is nullable and
NULL specifically means "keep using the environment's value", so filling
in only e.g. a password does not blank out a host/from-address the
deployment already fixed via `.env`.
"""

from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IntPrimaryKeyMixin, TimestampMixin


class Setting(IntPrimaryKeyMixin, TimestampMixin, Base):
    """One row per option the shop has actually changed.

    Deliberately key/value rather than a column per option: what each key
    means, what type it is and how it's presented all live in
    `app.settings.registry`, so a new option costs one entry there and no
    migration at all. A key that isn't in the registry (left behind by a
    downgrade, say) is ignored on read.

    Absent row = the registry's default. Storing only the overrides keeps
    "never touched it" and "set it to exactly the default" distinguishable,
    which is what lets a default be improved later without silently
    overwriting a deliberate choice.
    """

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    #: Always the string form; `SettingDef.parse` turns it into the real
    #: type. Text rather than String so a multi-line option (a footer, a
    #: legal notice) isn't silently truncated.
    value: Mapped[str] = mapped_column(Text)


class SystemSettings(IntPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "system_settings"

    smtp_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    smtp_use_tls: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    smtp_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_from_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Who gets emailed when a notification rule opens a brand-new incident
    #: (`app.notifications.service.evaluate_rules`) — see `Settings`'s own
    #: field for the env-side default.
    notification_recipient_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
