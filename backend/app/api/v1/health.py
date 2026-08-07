"""Liveness and readiness probes."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import ServiceUnavailableError
from app.core.logging import get_logger
from app.db.session import get_session

router = APIRouter(tags=["health"])
logger = get_logger(__name__)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


class LiveResponse(BaseModel):
    status: Literal["ok"]
    app: str
    environment: str


class ReadyResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]


@router.get("/health/live", response_model=LiveResponse, summary="Liveness probe")
async def live(settings: SettingsDep) -> LiveResponse:
    """The process is up.  Does not touch any dependency."""
    return LiveResponse(status="ok", app=settings.app_name, environment=settings.environment)


@router.get("/health/ready", response_model=ReadyResponse, summary="Readiness probe")
async def ready(session: SessionDep) -> ReadyResponse:
    """The process can serve traffic: the database answers."""
    try:
        await session.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - exercised only when PG is down
        logger.warning("health.database_unreachable", extra={"error": str(exc)})
        raise ServiceUnavailableError("Database is not reachable.") from exc
    return ReadyResponse(status="ok", database="ok")
