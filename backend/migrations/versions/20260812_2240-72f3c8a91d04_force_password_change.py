"""force password change after an administrative reset

Revision ID: 72f3c8a91d04
Revises: 2d7c4a8e1f65
Create Date: 2026-08-12 22:40:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "72f3c8a91d04"
down_revision: str | None = "2d7c4a8e1f65"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
