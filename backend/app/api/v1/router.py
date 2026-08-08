"""Aggregate router for API v1.

Each phase mounts its module router here.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import health
from app.audit.router import router as audit_router
from app.auth.router import router as auth_router
from app.catalog.router import router as catalog_router
from app.pricing.router import router as pricing_router
from app.rbac.router import router as rbac_router
from app.users.router import router as users_router

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(rbac_router)
api_router.include_router(audit_router)
api_router.include_router(catalog_router)
api_router.include_router(pricing_router)

# Phase 5: api_router.include_router(suppliers.router)
# ... one line per module as its phase lands.
