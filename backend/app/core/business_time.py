"""Small, explicit conversions between absolute and commercial time.

Persisted datetimes remain timezone-aware instants.  These helpers are only
for the places where the application needs the shop's calendar: displaying an
instant, deciding its commercial date, or translating a date-only filter into
an absolute PostgreSQL range.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import Date, cast, func


def parse_timezone(value: str) -> ZoneInfo:
    """Resolve one IANA timezone name, with an error suitable for validation."""
    try:
        return ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ValueError(
            "Tiene que ser una zona horaria IANA válida, por ejemplo Europe/Madrid."
        ) from exc


def _require_aware(instant: datetime) -> None:
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("El instante debe incluir zona horaria.")


def to_business_time(instant: datetime, timezone: ZoneInfo) -> datetime:
    """Represent an absolute instant in the shop timezone."""
    _require_aware(instant)
    return instant.astimezone(timezone)


def business_date(instant: datetime, timezone: ZoneInfo) -> date:
    """Commercial calendar date containing an absolute instant."""
    return to_business_time(instant, timezone).date()


def business_today(timezone: ZoneInfo, *, now: datetime | None = None) -> date:
    """Today's date in the shop, independently of server/browser timezone."""
    instant = datetime.now(UTC) if now is None else now
    return business_date(instant, timezone)


def business_day_utc_range(day: date, timezone: ZoneInfo) -> tuple[datetime, datetime]:
    """Return ``[local midnight, next local midnight)`` as UTC instants.

    The next boundary is built in the local calendar rather than by adding 24
    hours to the first UTC instant, so spring/autumn DST days retain their real
    23/25-hour duration.
    """
    local_start = datetime.combine(day, time.min, tzinfo=timezone)
    local_end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=timezone)
    return local_start.astimezone(UTC), local_end.astimezone(UTC)


def business_date_expression(instant: Any, timezone: ZoneInfo) -> Any:
    """PostgreSQL date bucket in an explicit, safely-bound business timezone."""
    return cast(func.timezone(timezone.key, instant), Date)
