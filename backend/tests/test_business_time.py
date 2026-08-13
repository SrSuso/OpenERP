"""Pure tests for the boundary between absolute and commercial time."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.core.business_time import (
    business_date,
    business_day_utc_range,
    business_today,
    parse_timezone,
    to_business_time,
)

MADRID = ZoneInfo("Europe/Madrid")


def test_absolute_instant_is_presented_in_business_timezone() -> None:
    instant = datetime(2026, 8, 12, 22, 30, tzinfo=UTC)

    local = to_business_time(instant, MADRID)

    assert local.isoformat() == "2026-08-13T00:30:00+02:00"


def test_midnight_boundary_classifies_each_instant_in_its_business_day() -> None:
    before = datetime(2026, 8, 12, 21, 59, 59, tzinfo=UTC)
    after = datetime(2026, 8, 12, 22, 0, tzinfo=UTC)

    assert business_date(before, MADRID) == date(2026, 8, 12)
    assert business_date(after, MADRID) == date(2026, 8, 13)


def test_business_date_can_differ_from_utc_date() -> None:
    instant = datetime(2026, 8, 12, 22, 30, tzinfo=UTC)

    assert instant.date() == date(2026, 8, 12)
    assert business_date(instant, MADRID) == date(2026, 8, 13)


def test_spring_dst_day_uses_local_midnights_and_lasts_23_hours() -> None:
    start, end = business_day_utc_range(date(2026, 3, 29), MADRID)

    assert start == datetime(2026, 3, 28, 23, tzinfo=UTC)
    assert end == datetime(2026, 3, 29, 22, tzinfo=UTC)
    assert end - start == timedelta(hours=23)


def test_autumn_dst_day_uses_local_midnights_and_lasts_25_hours() -> None:
    start, end = business_day_utc_range(date(2026, 10, 25), MADRID)

    assert start == datetime(2026, 10, 24, 22, tzinfo=UTC)
    assert end == datetime(2026, 10, 25, 23, tzinfo=UTC)
    assert end - start == timedelta(hours=25)


def test_today_is_the_business_date_at_the_controlled_instant() -> None:
    instant = datetime(2026, 8, 12, 22, 30, tzinfo=UTC)

    assert business_today(MADRID, now=instant) == date(2026, 8, 13)
    assert business_today(ZoneInfo("UTC"), now=instant) == date(2026, 8, 12)


def test_invalid_or_naive_values_are_rejected() -> None:
    with pytest.raises(ValueError, match="zona horaria IANA válida"):
        parse_timezone("Europe/No_Existe")
    with pytest.raises(ValueError, match="incluir zona horaria"):
        to_business_time(datetime(2026, 8, 13, 12), MADRID)
