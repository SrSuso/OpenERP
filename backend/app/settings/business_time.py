"""Resolve the commercial timezone through the existing settings registry."""

from __future__ import annotations

from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_time import parse_timezone
from app.settings import store


async def get_business_timezone(session: AsyncSession) -> ZoneInfo:
    value = await store.get_value(session, "business.timezone")
    return parse_timezone(str(value))
