"""seed standard product units

Revision ID: a8d4e1f2c9b7
Revises: f7a3d2e8c4b6
Create Date: 2026-08-17 14:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision = "a8d4e1f2c9b7"
down_revision = "f7a3d2e8c4b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Keep user-created units intact. A fresh shop gets these three useful
    # base choices, while an existing one gains only whichever are absent.
    op.execute(
        """
        INSERT INTO units (name, display_order)
        VALUES ('KG', 0), ('L', 1), ('UDS', 2)
        ON CONFLICT (name) DO NOTHING
        """
    )


def downgrade() -> None:
    # Do not delete a standard unit on downgrade: products keep unit names as
    # historical data, and a user may already have selected one.
    pass
