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
from app.dashboards import models as dashboard_models
from app.db.base import Base
from app.idempotency import models as idempotency_models
from app.inventory import models as inventory_models
from app.jobs import models as job_models
from app.lots import models as lot_models
from app.notifications import models as notification_models
from app.pos import models as pos_models
from app.pricing import models as pricing_models
from app.purchasing import models as purchasing_models
from app.rbac import models as rbac_models
from app.reports import models as report_models
from app.returns import models as return_models
from app.sales import models as sales_models
from app.settings import models as settings_models
from app.suppliers import models as supplier_models
from app.tickets import models as ticket_models
from app.users import models as user_models

# ... one line per module as its phase lands.

__all__ = [
    "Base",
    "audit_models",
    "auth_models",
    "catalog_models",
    "dashboard_models",
    "idempotency_models",
    "inventory_models",
    "job_models",
    "lot_models",
    "notification_models",
    "pos_models",
    "pricing_models",
    "purchasing_models",
    "rbac_models",
    "report_models",
    "return_models",
    "sales_models",
    "settings_models",
    "supplier_models",
    "ticket_models",
    "user_models",
]
