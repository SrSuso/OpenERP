"""Reading and writing the registry-backed business settings."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationError
from app.settings.models import Setting
from app.settings.registry import SETTINGS_BY_KEY, SettingDef


async def _overrides(session: AsyncSession) -> dict[str, str]:
    rows = (await session.execute(select(Setting))).scalars()
    # A key no longer in the registry (left behind by a downgrade) is
    # ignored rather than an error — see `Setting`'s docstring.
    return {row.key: row.value for row in rows if row.key in SETTINGS_BY_KEY}


async def get_values(session: AsyncSession) -> dict[str, Any]:
    """Every option in the registry, parsed: the shop's own value where it
    set one, the registry default everywhere else.

    A stored value that no longer parses (the option's type or range was
    tightened in a later version) falls back to the default rather than
    breaking whatever is reading it — the panel will show the default and
    the next save fixes it.
    """
    stored = await _overrides(session)
    values: dict[str, Any] = {}
    for key, definition in SETTINGS_BY_KEY.items():
        raw = stored.get(key)
        if raw is None:
            values[key] = definition.default
            continue
        try:
            values[key] = definition.parse(raw)
        except ValueError:
            values[key] = definition.default
    return values


async def get_value(session: AsyncSession, key: str) -> Any:
    """One option. Convenience for the callers that only need a single
    knob; anything reading several should use `get_values` once."""
    return (await get_values(session))[key]


def validate(changes: dict[str, str]) -> dict[str, SettingDef]:
    """Check a whole batch before writing any of it, so a screenful of
    edits either saves completely or not at all. Returns the definitions
    keyed by setting key, for the caller to reuse."""
    unknown = sorted(set(changes) - set(SETTINGS_BY_KEY))
    if unknown:
        raise ValidationError(f"Ajustes desconocidos: {', '.join(unknown)}.")

    definitions: dict[str, SettingDef] = {}
    errors: dict[str, str] = {}
    for key, raw in changes.items():
        definition = SETTINGS_BY_KEY[key]
        try:
            definition.parse(raw)
        except ValueError as exc:
            errors[key] = str(exc)
        definitions[key] = definition
    if errors:
        raise ValidationError(
            "; ".join(f"{SETTINGS_BY_KEY[k].label}: {msg}" for k, msg in sorted(errors.items()))
        )
    return definitions


async def update_values(session: AsyncSession, changes: dict[str, str]) -> dict[str, Any]:
    """Upsert the given options. Only the keys present are touched, so the
    panel can save one card without sending the rest of the screen."""
    validate(changes)

    existing = {
        row.key: row
        for row in (
            await session.execute(select(Setting).where(Setting.key.in_(list(changes))))
        ).scalars()
    }
    for key, raw in changes.items():
        row = existing.get(key)
        if row is None:
            session.add(Setting(key=key, value=raw))
        else:
            row.value = raw
    await session.flush()
    return await get_values(session)
