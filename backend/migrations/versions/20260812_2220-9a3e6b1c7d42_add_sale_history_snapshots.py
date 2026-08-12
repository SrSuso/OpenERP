"""add immutable product, cost and cashier sale snapshots

Only draft/cancelled rows are backfilled automatically: they do not yet
represent a completed economic event.  Completed rows are deliberately left
for explicit reconciliation before the following revision makes their
snapshots mandatory.

Revision ID: 9a3e6b1c7d42
Revises: 4c8d1e7a5b32
Create Date: 2026-08-12 22:20:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9a3e6b1c7d42"
down_revision: str | None = "4c8d1e7a5b32"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("cashier_name", sa.String(length=255), nullable=True))
    op.add_column("sale_lines", sa.Column("product_sku", sa.String(length=50), nullable=True))
    op.add_column("sale_lines", sa.Column("product_name", sa.String(length=255), nullable=True))
    op.add_column("sale_lines", sa.Column("product_category_id", sa.BigInteger(), nullable=True))
    op.add_column(
        "sale_lines", sa.Column("product_category_name", sa.String(length=100), nullable=True)
    )
    op.add_column(
        "sale_lines",
        sa.Column("unit_cost", sa.Numeric(precision=18, scale=6), nullable=True),
    )
    op.add_column("sale_lines", sa.Column("tracks_stock", sa.Boolean(), nullable=True))
    op.add_column("sale_lines", sa.Column("track_lots", sa.Boolean(), nullable=True))

    # These rows are only carts, not immutable history.  Taking their current
    # catalogue data is therefore exact and lets them continue to checkout.
    op.execute(
        sa.text(
            "UPDATE sale_lines AS sl SET "
            "product_sku = p.sku, product_name = p.name, "
            "product_category_id = p.category_id, product_category_name = pc.name, "
            "unit_cost = p.cost, "
            "tracks_stock = coalesce(p.tracks_stock, pc.tracks_stock, true), "
            "track_lots = p.track_lots "
            "FROM sales AS s, products AS p "
            "LEFT JOIN product_categories AS pc ON pc.id = p.category_id "
            "WHERE sl.sale_id = s.id AND sl.product_id = p.id "
            "AND s.status <> 'COMPLETED'"
        )
    )


def downgrade() -> None:
    op.drop_column("sale_lines", "track_lots")
    op.drop_column("sale_lines", "tracks_stock")
    op.drop_column("sale_lines", "unit_cost")
    op.drop_column("sale_lines", "product_category_name")
    op.drop_column("sale_lines", "product_category_id")
    op.drop_column("sale_lines", "product_name")
    op.drop_column("sale_lines", "product_sku")
    op.drop_column("sales", "cashier_name")
