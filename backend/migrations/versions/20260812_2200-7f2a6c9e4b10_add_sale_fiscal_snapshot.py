"""add the per-sale fiscal snapshot

The column is introduced separately from the constraint so a preproduction
database with completed test sales can stop at this revision and have their
real fiscal mode assigned explicitly.  Guessing it from the current formula
or setting would manufacture history.

Revision ID: 7f2a6c9e4b10
Revises: d1f83c60a97e
Create Date: 2026-08-12 22:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7f2a6c9e4b10"
down_revision: str | None = "d1f83c60a97e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("prices_include_tax", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("sales", "prices_include_tax")
