"""Single import point for every mapped model.

Alembic autogenerate only sees tables that have been imported by the time it
inspects ``Base.metadata``.  Each phase adds its module's models here.

Importing this module has no side effects beyond registering mappers.
"""

from __future__ import annotations

from app.db.base import Base

# Phase 1+: from app.auth import models as auth_models
# Phase 1+: from app.users import models as user_models
# ... one line per module as its phase lands.

__all__ = ["Base"]
