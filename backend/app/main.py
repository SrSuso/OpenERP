"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# isort: off
# Must run before anything below touches a SQLAlchemy mapper (e.g. a
# module-level `selectinload(...)` tuple, several routers have one):
# configuring any one mapper configures *every* pending one in the shared
# registry, and a relationship that references another module's model by
# name only (app.catalog.models's `taxes`, resolved against
# app.pricing.models's `Tax` — see that relationship's own docstring on
# why it isn't a real import instead) fails to resolve if that module
# hasn't been imported yet. `app.api.v1.router` below imports catalog's
# router well before pricing's own line in the same file, so without
# this, whichever import happens to trigger configuration first raises.
from app.db import registry as _model_registry  # noqa: F401
# isort: on

from app.api.middleware import (
    REQUEST_ID_HEADER,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from app.api.v1.router import api_router
from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.db.session import dispose_engine

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    logger.info(
        "app.startup",
        extra={"environment": settings.environment, "app": settings.app_name},
    )
    yield
    await dispose_engine()
    logger.info("app.shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(level=settings.log_level, fmt=settings.log_format)

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Modular monolith ERP for retail: administration panel and POS.",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings

    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )

    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    return app


app = create_app()
