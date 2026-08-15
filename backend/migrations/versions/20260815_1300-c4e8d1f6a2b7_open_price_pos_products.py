"""add open-price POS product buttons

Revision ID: c4e8d1f6a2b7
Revises: b2d9e8f4c6a1
Create Date: 2026-08-15 13:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4e8d1f6a2b7"
down_revision = "b2d9e8f4c6a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("is_open_price", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("products", "is_open_price")
