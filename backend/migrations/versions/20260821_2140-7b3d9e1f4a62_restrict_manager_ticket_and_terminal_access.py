"""restrict manager ticket-template and POS-terminal access

Revision ID: 7b3d9e1f4a62
Revises: f1d4c8a2b6e5
Create Date: 2026-08-21 21:40:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.rbac.permissions import PHASE_26_PERMISSIONS, PHASE_26_ROLE_GRANTS, TICKET_MANAGE

revision: str = "7b3d9e1f4a62"
down_revision: str | None = "f1d4c8a2b6e5"
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
        [{"key": item.key, "description": item.description} for item in PHASE_26_PERMISSIONS],
    )
    permission_ids = dict(
        connection.execute(sa.select(_permissions.c.key, _permissions.c.id)).all()
    )
    role_ids = dict(connection.execute(sa.select(_roles.c.name, _roles.c.id)).all())

    connection.execute(
        sa.insert(_role_permissions),
        [
            {"role_id": role_ids[role_name], "permission_id": permission_ids[key]}
            for role_name, keys in PHASE_26_ROLE_GRANTS.items()
            for key in keys
        ],
    )
    connection.execute(
        _role_permissions.delete().where(
            _role_permissions.c.role_id == role_ids["MANAGER"],
            _role_permissions.c.permission_id == permission_ids[TICKET_MANAGE],
        )
    )


def downgrade() -> None:
    connection = op.get_bind()
    permission_ids = dict(
        connection.execute(sa.select(_permissions.c.key, _permissions.c.id)).all()
    )
    role_ids = dict(connection.execute(sa.select(_roles.c.name, _roles.c.id)).all())
    connection.execute(
        sa.insert(_role_permissions),
        {
            "role_id": role_ids["MANAGER"],
            "permission_id": permission_ids[TICKET_MANAGE],
        },
    )

    keys = [item.key for item in PHASE_26_PERMISSIONS]
    new_permission_ids = [permission_ids[key] for key in keys]
    connection.execute(
        _role_permissions.delete().where(_role_permissions.c.permission_id.in_(new_permission_ids))
    )
    connection.execute(_permissions.delete().where(_permissions.c.id.in_(new_permission_ids)))
