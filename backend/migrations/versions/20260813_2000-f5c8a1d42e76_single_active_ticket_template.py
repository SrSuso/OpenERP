"""single active ticket template

Revision ID: f5c8a1d42e76
Revises: e4a7c2d91b65
Create Date: 2026-08-13 20:00:00+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f5c8a1d42e76"
down_revision: str | None = "e4a7c2d91b65"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    active_count = connection.scalar(
        sa.text("SELECT count(*) FROM ticket_templates WHERE is_active")
    )
    if active_count is not None and active_count > 1:
        raise RuntimeError(
            "Cannot enforce the single active ticket template invariant: "
            f"found {active_count} active templates in the global store scope. "
            "Deactivate all but the intended template explicitly, then retry the migration."
        )

    op.create_index(
        "uq_ticket_templates_single_active",
        "ticket_templates",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )


def downgrade() -> None:
    op.drop_index("uq_ticket_templates_single_active", table_name="ticket_templates")
