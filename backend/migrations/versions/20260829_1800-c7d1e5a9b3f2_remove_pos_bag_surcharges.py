"""remove the withdrawn POS bag-surcharge presentation

Revision ID: c7d1e5a9b3f2
Revises: b4e8d2f6a1c9
Create Date: 2026-08-29 18:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.rbac.permissions import POS_COLD_DRINK_SURCHARGE_MANAGE

revision: str = "c7d1e5a9b3f2"
down_revision: str | None = "b4e8d2f6a1c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_permissions = sa.table(
    "permissions",
    sa.column("key", sa.String),
    sa.column("description", sa.String),
)


def upgrade() -> None:
    op.execute(
        _permissions.update()
        .where(_permissions.c.key == POS_COLD_DRINK_SURCHARGE_MANAGE)
        .values(description="View and change the POS cold-drink surcharge amount.")
    )


def downgrade() -> None:
    op.execute(
        _permissions.update()
        .where(_permissions.c.key == POS_COLD_DRINK_SURCHARGE_MANAGE)
        .values(description="View and change the fixed POS supplements: cold drink and bags.")
    )
