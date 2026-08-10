"""FastAPI dependency for the store-wide pricing settings — fetched once
per request and reused by every endpoint that needs to know whether
prices already include tax (``sales``, ``returns``, ``tickets``), instead
of each one re-querying it separately.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.auth.dependencies import SessionDep
from app.pricing import service
from app.pricing.models import PricingSettings


async def get_pricing_settings(session: SessionDep) -> PricingSettings:
    return await service.get_settings(session)


PricingSettingsDep = Annotated[PricingSettings, Depends(get_pricing_settings)]
