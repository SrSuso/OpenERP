"""store the actual printable receipt profile

Revision ID: c3d4e5f6a7b8
Revises: b5e7f1c3d9a4
Create Date: 2026-08-17 17:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b5e7f1c3d9a4"
branch_labels = None
depends_on = None

_PROFILE_COLUMNS = (
    ("font_family", sa.String(length=30), "COURIER_NEW"),
    ("font_size_px", sa.Integer(), "9"),
    ("line_height_px", sa.Integer(), "12"),
    ("font_weight", sa.String(length=10), "NORMAL"),
    ("margin_top_mm", sa.Integer(), "0"),
    ("margin_bottom_mm", sa.Integer(), "0"),
)


def _add_profile_columns(table: str) -> None:
    for name, column_type, default in _PROFILE_COLUMNS:
        op.add_column(
            table,
            sa.Column(name, column_type, nullable=False, server_default=default),
        )


def upgrade() -> None:
    # ``width_mm`` used to mean the nominal roll width (58/80), which is not
    # the width a printer can ink. Rename it rather than retaining a misleading
    # API and translate the legacy presets to their conservative usable widths.
    for table in ("ticket_templates", "tickets"):
        op.alter_column(table, "width_mm", new_column_name="printable_width_mm")
        op.execute(
            sa.text(
                f"UPDATE {table} SET printable_width_mm = "
                "CASE printable_width_mm WHEN 58 THEN 48 WHEN 80 THEN 72 "
                "ELSE printable_width_mm END"
            )
        )
        _add_profile_columns(table)


def downgrade() -> None:
    for table in ("tickets", "ticket_templates"):
        for name, _, _ in reversed(_PROFILE_COLUMNS):
            op.drop_column(table, name)
        # Old releases only understood the two historical presets. This is a
        # lossy compatibility mapping for a downgrade, never used by current
        # code to render a ticket.
        op.execute(
            sa.text(
                f"UPDATE {table} SET printable_width_mm = "
                "CASE WHEN printable_width_mm <= 54 THEN 58 ELSE 80 END"
            )
        )
        op.alter_column(table, "printable_width_mm", new_column_name="width_mm")
