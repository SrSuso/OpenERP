"""store the result of idempotent create operations

Revision ID: 8c4e2a7f1b93
Revises: 51a2d7c9e4b6
Create Date: 2026-08-13 09:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8c4e2a7f1b93"
down_revision: str | None = "51a2d7c9e4b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "idempotency_records",
        sa.Column("result_resource_id", sa.BigInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("idempotency_records", "result_resource_id")
