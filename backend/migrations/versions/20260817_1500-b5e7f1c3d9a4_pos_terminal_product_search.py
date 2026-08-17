"""add POS terminal product search preference

Revision ID: b5e7f1c3d9a4
Revises: a8d4e1f2c9b7
Create Date: 2026-08-17 15:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b5e7f1c3d9a4"
down_revision = "a8d4e1f2c9b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pos_terminals",
        sa.Column("show_product_search", sa.Boolean(), server_default="true", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("pos_terminals", "show_product_search")
