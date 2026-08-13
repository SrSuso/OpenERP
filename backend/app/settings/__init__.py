"""Admin-editable, PostgreSQL-backed business settings.

Process infrastructure and credentials deliberately do not belong to this
package.  API, worker, Alembic and operational scripts all obtain those from
``app.core.config.Settings`` instead.
"""

from __future__ import annotations
