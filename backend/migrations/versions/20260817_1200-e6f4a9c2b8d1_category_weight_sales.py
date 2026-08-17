"""add category-controlled POS weight sales

Revision ID: e6f4a9c2b8d1
Revises: c4e8d1f6a2b7
Create Date: 2026-08-17 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e6f4a9c2b8d1"
down_revision = "c4e8d1f6a2b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "product_categories",
        sa.Column("is_sold_by_weight", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("product_categories", "is_sold_by_weight")
