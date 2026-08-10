"""phase 21: system settings

Revision ID: d110f7909c5b
Revises: 1691779ca1d2
Create Date: 2026-08-10 11:42:53.713976+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.rbac.permissions import PHASE_21_PERMISSIONS, PHASE_21_ROLE_GRANTS

revision: str = "d110f7909c5b"
down_revision: str | None = "1691779ca1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Lightweight table handles for the seed data below — see the phase 1
# migration for why these aren't the ORM models.
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
    op.create_table(
        "system_settings",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("smtp_host", sa.String(length=255), nullable=True),
        sa.Column("smtp_port", sa.Integer(), nullable=True),
        sa.Column("smtp_use_tls", sa.Boolean(), nullable=True),
        sa.Column("smtp_username", sa.String(length=255), nullable=True),
        sa.Column("smtp_password", sa.String(length=255), nullable=True),
        sa.Column("smtp_from_email", sa.String(length=255), nullable=True),
        sa.Column("notification_recipient_email", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_system_settings")),
    )

    _seed_permissions()


def _seed_permissions() -> None:
    connection = op.get_bind()

    connection.execute(
        sa.insert(_permissions),
        [{"key": p.key, "description": p.description} for p in PHASE_21_PERMISSIONS],
    )
    permission_ids = dict(
        connection.execute(sa.select(_permissions.c.key, _permissions.c.id)).all()
    )
    role_ids = dict(connection.execute(sa.select(_roles.c.name, _roles.c.id)).all())

    grants = [
        {"role_id": role_ids[role_name], "permission_id": permission_ids[key]}
        for role_name, keys in PHASE_21_ROLE_GRANTS.items()
        for key in keys
    ]
    if grants:
        connection.execute(sa.insert(_role_permissions), grants)


def downgrade() -> None:
    _unseed_permissions()

    op.drop_table("system_settings")


def _unseed_permissions() -> None:
    connection = op.get_bind()
    keys = [p.key for p in PHASE_21_PERMISSIONS]

    permission_ids = [
        row[0]
        for row in connection.execute(
            sa.select(_permissions.c.id).where(_permissions.c.key.in_(keys))
        ).all()
    ]
    if permission_ids:
        connection.execute(
            _role_permissions.delete().where(_role_permissions.c.permission_id.in_(permission_ids))
        )
        connection.execute(_permissions.delete().where(_permissions.c.id.in_(permission_ids)))
