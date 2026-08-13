"""Persisted business settings from ``app.settings.registry``."""

from __future__ import annotations

from sqlalchemy import String, Text
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
