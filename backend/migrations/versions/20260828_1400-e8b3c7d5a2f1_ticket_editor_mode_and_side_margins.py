"""add ticket editor mode and 80mm side margins

Revision ID: e8b3c7d5a2f1
Revises: d2e6f5a1c4b8
Create Date: 2026-08-28 14:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e8b3c7d5a2f1"
down_revision: str | None = "d2e6f5a1c4b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_side_margins(table: str, *, center_existing: bool) -> None:
    op.add_column(
        table,
        sa.Column("margin_left_mm", sa.Integer(), nullable=True, server_default="0"),
    )
    op.add_column(
        table,
        sa.Column("margin_right_mm", sa.Integer(), nullable=True, server_default="0"),
    )
    if center_existing:
        op.execute(
            sa.text(
                f"UPDATE {table} SET "
                "margin_left_mm = GREATEST(0, (80 - printable_width_mm) / 2), "
                "margin_right_mm = GREATEST(0, 80 - printable_width_mm "
                "- GREATEST(0, (80 - printable_width_mm) / 2))"
            )
        )
    op.alter_column(table, "margin_left_mm", nullable=False)
    op.alter_column(table, "margin_right_mm", nullable=False)


def upgrade() -> None:
    # Centre active designs on the physical roll. Historical tickets keep
    # zero side margins because that is exactly how their frozen profile was
    # printed before this setting existed.
    _add_side_margins("ticket_templates", center_existing=True)
    _add_side_margins("tickets", center_existing=False)
    op.add_column(
        "ticket_templates",
        sa.Column("layout_mode", sa.String(length=10), nullable=False, server_default="STANDARD"),
    )
    # Layouts saved before the explicit selector existed were custom whenever
    # their source was non-empty. Preserve that behaviour during the upgrade.
    op.execute(
        sa.text(
            "UPDATE ticket_templates SET layout_mode = 'CUSTOM' WHERE BTRIM(layout_template) <> ''"
        )
    )
    op.create_check_constraint(
        "ck_ticket_templates_print_area_within_80mm",
        "ticket_templates",
        "margin_left_mm >= 0 AND margin_right_mm >= 0 "
        "AND printable_width_mm + margin_left_mm + margin_right_mm <= 80",
    )
    op.create_check_constraint(
        "ck_tickets_print_area_within_80mm",
        "tickets",
        "margin_left_mm >= 0 AND margin_right_mm >= 0 "
        "AND printable_width_mm + margin_left_mm + margin_right_mm <= 80",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_tickets_print_area_within_80mm",
        "tickets",
        type_="check",
    )
    op.drop_constraint(
        "ck_ticket_templates_print_area_within_80mm",
        "ticket_templates",
        type_="check",
    )
    op.drop_column("ticket_templates", "layout_mode")
    for table in ("tickets", "ticket_templates"):
        op.drop_column(table, "margin_right_mm")
        op.drop_column(table, "margin_left_mm")
