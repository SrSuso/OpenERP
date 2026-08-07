"""Aggregate router for API v1.

Each phase mounts its module router here.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import health

api_router = APIRouter()
api_router.include_router(health.router)

# Phase 1: api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
# Phase 3: api_router.include_router(catalog.router, prefix="/products", ...)
# ... one line per module as its phase lands.
