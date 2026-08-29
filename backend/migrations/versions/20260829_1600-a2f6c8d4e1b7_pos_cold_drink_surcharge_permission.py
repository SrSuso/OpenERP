"""grant a dedicated permission for the POS cold-drink surcharge

Revision ID: a2f6c8d4e1b7
Revises: f1c9d4e7a2b6
Create Date: 2026-08-29 16:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.rbac.permissions import PHASE_27_PERMISSIONS, PHASE_27_ROLE_GRANTS

revision: str = "a2f6c8d4e1b7"
down_revision: str | None = "f1c9d4e7a2b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_permissions = sa.table(
    "permissions",
    sa.column("id", sa.BigInteger),
    sa.column("key", sa.String),
    sa.column("description", sa.String),
)
_roles = sa.table("roles", sa.column("id", sa.BigInteger), sa.column("name", sa.String))
_role_permissions = sa.table(
    "role_permissions",
    sa.column("role_id", sa.BigInteger),
    sa.column("permission_id", sa.BigInteger),
)


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.insert(_permissions),
        [{"key": item.key, "description": item.description} for item in PHASE_27_PERMISSIONS],
    )
    permission_ids = dict(
        connection.execute(sa.select(_permissions.c.key, _permissions.c.id)).all()
    )
    role_ids = dict(connection.execute(sa.select(_roles.c.name, _roles.c.id)).all())
    connection.execute(
        sa.insert(_role_permissions),
        [
            {"role_id": role_ids[role_name], "permission_id": permission_ids[key]}
            for role_name, keys in PHASE_27_ROLE_GRANTS.items()
            for key in keys
        ],
    )


def downgrade() -> None:
    connection = op.get_bind()
    keys = [item.key for item in PHASE_27_PERMISSIONS]
    permission_ids = dict(
        connection.execute(sa.select(_permissions.c.key, _permissions.c.id)).all()
    )
    new_permission_ids = [permission_ids[key] for key in keys]
    connection.execute(
        _role_permissions.delete().where(_role_permissions.c.permission_id.in_(new_permission_ids))
    )
    connection.execute(_permissions.delete().where(_permissions.c.id.in_(new_permission_ids)))
