"""default POS category and one-based product button ordering

Revision ID: f1c9d4e7a2b6
Revises: e8b3c7d5a2f1
Create Date: 2026-08-29 03:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f1c9d4e7a2b6"
down_revision = "e8b3c7d5a2f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pos_categories",
        sa.Column("is_default", sa.Boolean(), server_default="false", nullable=False),
    )
    op.create_index(
        "uq_pos_categories_single_default",
        "pos_categories",
        ["is_default"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )
    # Las filas existentes con 0 conservan expresamente el significado
    # «al final». Sólo cambia el valor por defecto de altas posteriores.
    op.alter_column("products", "pos_display_order", server_default="1")


def downgrade() -> None:
    op.alter_column("products", "pos_display_order", server_default="0")
    op.drop_index("uq_pos_categories_single_default", table_name="pos_categories")
    op.drop_column("pos_categories", "is_default")
