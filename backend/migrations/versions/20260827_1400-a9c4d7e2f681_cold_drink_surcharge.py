"""store cold-drink surcharge snapshots on sale lines

Revision ID: a9c4d7e2f681
Revises: 7b3d9e1f4a62
Create Date: 2026-08-27 14:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a9c4d7e2f681"
down_revision: str | None = "7b3d9e1f4a62"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sale_lines",
        sa.Column(
            "cold_drink_surcharge",
            sa.Numeric(18, 6),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("sale_lines", "cold_drink_surcharge")
