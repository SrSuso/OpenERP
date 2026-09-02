"""allow an optional own selling price for each product presentation

Revision ID: e7f1a2b3c4d5
Revises: d5e8f1a2b3c4
Create Date: 2026-09-03 02:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7f1a2b3c4d5"
down_revision: str | None = "d5e8f1a2b3c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NULL deliberately means "use the product PVP Final x the package
    # factor", preserving the prices of every existing presentation.
    op.add_column(
        "product_packages",
        sa.Column("price_override", sa.Numeric(18, 6), nullable=True),
    )
    op.add_column(
        "sale_lines",
        sa.Column("package_price_override", sa.Numeric(18, 6), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sale_lines", "package_price_override")
    op.drop_column("product_packages", "price_override")
