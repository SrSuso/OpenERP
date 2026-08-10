"""notification_rule severity

Criticidad de la regla, en cuatro niveles, para que un aviso importante
se distinga de uno de rutina en el panel.

Revision ID: 2a69ea50f166
Revises: 5b4760e2a878
Create Date: 2026-08-10 22:46:36.773655+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2a69ea50f166"
down_revision: str | None = "5b4760e2a878"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notification_rules",
        sa.Column("severity", sa.String(length=20), server_default="MEDIUM_LOW", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("notification_rules", "severity")
