"""allow deleting ticket templates while retaining receipt snapshots

Revision ID: f1d4c8a2b6e5
Revises: c3d4e5f6a7b8
Create Date: 2026-08-20 19:30:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f1d4c8a2b6e5"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None

_FOREIGN_KEY = "fk_tickets_template_id_ticket_templates"


def upgrade() -> None:
    # Tickets duplicate all of the layout data and the rendered text. A
    # template is therefore configuration, not the historical receipt
    # itself; deleting it must not force a shop to keep a mistaken layout.
    op.drop_constraint(_FOREIGN_KEY, "tickets", type_="foreignkey")
    op.alter_column("tickets", "template_id", existing_type=sa.BigInteger(), nullable=True)
    op.create_foreign_key(
        _FOREIGN_KEY,
        "tickets",
        "ticket_templates",
        ["template_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # A pre-change version cannot represent ticket snapshots whose source
    # template was deliberately deleted. Refuse a destructive downgrade.
    missing_templates = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM tickets WHERE template_id IS NULL")
    )
    if missing_templates:
        raise RuntimeError(
            "Cannot restore the required ticket template link: existing tickets refer to "
            "deleted templates."
        )

    op.drop_constraint(_FOREIGN_KEY, "tickets", type_="foreignkey")
    op.alter_column("tickets", "template_id", existing_type=sa.BigInteger(), nullable=False)
    op.create_foreign_key(
        _FOREIGN_KEY,
        "tickets",
        "ticket_templates",
        ["template_id"],
        ["id"],
    )
