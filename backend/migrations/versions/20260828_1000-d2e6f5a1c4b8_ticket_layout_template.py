"""add safe editable layout source to ticket templates

Revision ID: d2e6f5a1c4b8
Revises: a9c4d7e2f681
Create Date: 2026-08-28 10:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d2e6f5a1c4b8"
down_revision: str | None = "a9c4d7e2f681"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ticket_templates",
        sa.Column("layout_template", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("ticket_templates", "layout_template")
