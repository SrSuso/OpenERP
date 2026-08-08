"""Single import point for every mapped model.

Alembic autogenerate only sees tables that have been imported by the time it
inspects ``Base.metadata``.  Each phase adds its module's models here.

Importing this module has no side effects beyond registering mappers.

Note: a model must be imported after the ones it declares a ``ForeignKey``
against at class-definition time — rbac before users before auth — even
though Alembic itself only needs every module imported by the time it
inspects ``Base.metadata``.
"""

from __future__ import annotations

from app.audit import models as audit_models
from app.auth import models as auth_models
from app.catalog import models as catalog_models
from app.db.base import Base
from app.pricing import models as pricing_models
from app.rbac import models as rbac_models
from app.users import models as user_models

# ... one line per module as its phase lands.

__all__ = [
    "Base",
    "audit_models",
    "auth_models",
    "catalog_models",
    "pricing_models",
    "rbac_models",
    "user_models",
]
