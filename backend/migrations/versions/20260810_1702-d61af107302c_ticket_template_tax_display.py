"""ticket_template tax_display

Replaces ``ticket_templates.show_tax_breakdown`` (bool) with
``tax_display`` (NONE/NOTE/BREAKDOWN). The boolean could only choose
between a per-rate breakdown and nothing at all, with no way to print the
plain "IVA incluido" a shop under recargo de equivalencia needs.

Existing templates keep what they had: ``true`` -> ``BREAKDOWN``,
``false`` -> ``NONE``. Already-issued tickets are unaffected either way —
``tickets.rendered_text`` is frozen at generation time.

Revision ID: d61af107302c
Revises: 547ee9f06037
Create Date: 2026-08-10 17:02:02.707537+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d61af107302c"
down_revision: str | None = "547ee9f06037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ticket_templates",
        sa.Column("tax_display", sa.String(length=20), server_default="BREAKDOWN", nullable=False),
    )
    op.execute(
        "UPDATE ticket_templates "
        "SET tax_display = CASE WHEN show_tax_breakdown THEN 'BREAKDOWN' ELSE 'NONE' END"
    )
    op.drop_column("ticket_templates", "show_tax_breakdown")


def downgrade() -> None:
    op.add_column(
        "ticket_templates",
        sa.Column("show_tax_breakdown", sa.Boolean(), server_default="true", nullable=False),
    )
    # NOTE collapses back into "no breakdown" — the boolean cannot express it.
    op.execute("UPDATE ticket_templates SET show_tax_breakdown = (tax_display = 'BREAKDOWN')")
    op.drop_column("ticket_templates", "tax_display")
