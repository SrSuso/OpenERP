"""index dashboard owners

Revision ID: b7e2c4a91d63
Revises: 6a4d2f8c1b73
Create Date: 2026-08-13 18:00:00+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "b7e2c4a91d63"
down_revision: str | None = "6a4d2f8c1b73"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        op.f("ix_dashboards_owner_user_id"),
        "dashboards",
        ["owner_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_dashboards_owner_user_id"), table_name="dashboards")
