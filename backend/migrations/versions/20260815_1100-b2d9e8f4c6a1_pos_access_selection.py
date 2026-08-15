"""add explicit POS user selection

Revision ID: b2d9e8f4c6a1
Revises: a7e4c2b9d8f1
Create Date: 2026-08-15 11:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b2d9e8f4c6a1"
down_revision = "a7e4c2b9d8f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("pos_access_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Existing POS credentials were deliberately created by an administrator
    # in the immediately preceding feature. Preserve that explicit choice so
    # this upgrade cannot unexpectedly lock current cashiers out.
    op.execute(
        """
        UPDATE users
        SET pos_access_enabled = true
        WHERE pos_username IS NOT NULL AND pos_pin_hash IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column("users", "pos_access_enabled")
