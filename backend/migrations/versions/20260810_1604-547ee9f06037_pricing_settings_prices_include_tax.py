"""pricing_settings prices_include_tax

Revision ID: 547ee9f06037
Revises: b660c928adc0
Create Date: 2026-08-10 16:04:45.293124+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "547ee9f06037"
down_revision: str | None = "b660c928adc0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable for one revision on purpose.  A pre-existing custom formula
    # does not reveal whether its shelf prices include tax; 5b4760e2a878
    # only fills the exact formula seeded by this project and otherwise
    # requires an explicit operator decision.
    op.add_column(
        "pricing_settings",
        sa.Column("prices_include_tax", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pricing_settings", "prices_include_tax")
