"""add a default unit to product categories

Revision ID: f7a3d2e8c4b6
Revises: e6f4a9c2b8d1
Create Date: 2026-08-17 13:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f7a3d2e8c4b6"
down_revision = "e6f4a9c2b8d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("product_categories", sa.Column("default_unit_name", sa.String(length=20)))


def downgrade() -> None:
    op.drop_column("product_categories", "default_unit_name")
