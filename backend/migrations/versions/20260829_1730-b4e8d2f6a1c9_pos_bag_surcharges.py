"""add fixed POS bag supplements

Revision ID: b4e8d2f6a1c9
Revises: a2f6c8d4e1b7
Create Date: 2026-08-29 17:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.rbac.permissions import POS_COLD_DRINK_SURCHARGE_MANAGE

revision: str = "b4e8d2f6a1c9"
down_revision: str | None = "a2f6c8d4e1b7"
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
    op.add_column("sale_lines", sa.Column("pos_surcharge_label", sa.String(50), nullable=True))
    connection = op.get_bind()
    permission_id = connection.execute(
        sa.select(_permissions.c.id).where(_permissions.c.key == POS_COLD_DRINK_SURCHARGE_MANAGE)
    ).scalar_one()
    manager_id = connection.execute(
        sa.select(_roles.c.id).where(_roles.c.name == "MANAGER")
    ).scalar_one()
    connection.execute(
        _permissions.update()
        .where(_permissions.c.id == permission_id)
        .values(description="View and change the fixed POS supplements: cold drink and bags.")
    )
    already_granted = connection.execute(
        sa.select(_role_permissions.c.role_id).where(
            _role_permissions.c.role_id == manager_id,
            _role_permissions.c.permission_id == permission_id,
        )
    ).first()
    if already_granted is None:
        connection.execute(
            sa.insert(_role_permissions).values(role_id=manager_id, permission_id=permission_id)
        )


def downgrade() -> None:
    connection = op.get_bind()
    permission_id = connection.execute(
        sa.select(_permissions.c.id).where(_permissions.c.key == POS_COLD_DRINK_SURCHARGE_MANAGE)
    ).scalar_one()
    manager_id = connection.execute(
        sa.select(_roles.c.id).where(_roles.c.name == "MANAGER")
    ).scalar_one()
    connection.execute(
        _role_permissions.delete().where(
            _role_permissions.c.role_id == manager_id,
            _role_permissions.c.permission_id == permission_id,
        )
    )
    connection.execute(
        _permissions.update()
        .where(_permissions.c.id == permission_id)
        .values(description="View and change the POS cold-drink surcharge amount.")
    )
    op.drop_column("sale_lines", "pos_surcharge_label")
