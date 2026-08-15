"""add POS sessions and PIN credentials

Revision ID: a7e4c2b9d8f1
Revises: f5c8a1d42e76
Create Date: 2026-08-15 09:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7e4c2b9d8f1"
down_revision = "f5c8a1d42e76"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "auth_sessions",
        sa.Column("surface", sa.String(length=16), nullable=False, server_default="ADMIN"),
    )
    op.add_column("users", sa.Column("pos_username", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("pos_pin_hash", sa.String(length=255), nullable=True))
    op.create_index(
        "uq_users_pos_username_lower",
        "users",
        [sa.text("lower(pos_username)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_users_pos_username_lower", table_name="users")
    op.drop_column("users", "pos_pin_hash")
    op.drop_column("users", "pos_username")
    op.drop_column("auth_sessions", "surface")
