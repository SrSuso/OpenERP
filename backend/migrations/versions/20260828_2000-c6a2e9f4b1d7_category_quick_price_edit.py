"""add independent quick PVP editing to product categories

Revision ID: c6a2e9f4b1d7
Revises: f4c2a8d91e73
Create Date: 2026-08-28 20:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c6a2e9f4b1d7"
down_revision: str | None = "f4c2a8d91e73"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "product_categories",
        sa.Column(
            "quick_price_edit",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Main offered its inline PVP editor to weighed categories. Preserve that
    # useful behaviour for existing data, then let both switches evolve
    # independently from this revision onwards.
    op.execute(
        sa.text(
            "UPDATE product_categories SET quick_price_edit = true WHERE is_sold_by_weight = true"
        )
    )


def downgrade() -> None:
    op.drop_column("product_categories", "quick_price_edit")
