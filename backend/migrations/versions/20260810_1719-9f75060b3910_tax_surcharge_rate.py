"""tax surcharge_rate (recargo de equivalencia)

Each tax now carries the *recargo de equivalencia* that goes with it (5.2
with IVA 21, 1.4 with IVA 10, 0.5 with IVA 4). Defaults to 0, so a shop
that is not under the regime — and every existing install — is unchanged.

Revision ID: 9f75060b3910
Revises: d61af107302c
Create Date: 2026-08-10 17:19:13.171012+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9f75060b3910"
down_revision: str | None = "d61af107302c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "taxes",
        sa.Column(
            "surcharge_rate",
            sa.Numeric(precision=18, scale=6),
            server_default="0",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("taxes", "surcharge_rate")
