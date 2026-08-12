"""require a fiscal snapshot on every completed sale

Revision ID: 4c8d1e7a5b32
Revises: 7f2a6c9e4b10
Create Date: 2026-08-12 22:10:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "4c8d1e7a5b32"
down_revision: str | None = "7f2a6c9e4b10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT = "completed_has_fiscal_snapshot"


def upgrade() -> None:
    connection = op.get_bind()
    missing = (
        connection.execute(
            sa.text(
                "SELECT id FROM sales "
                "WHERE status = 'COMPLETED' AND prices_include_tax IS NULL ORDER BY id"
            )
        )
        .scalars()
        .all()
    )
    if missing:
        ids = ", ".join(str(sale_id) for sale_id in missing[:20])
        suffix = "..." if len(missing) > 20 else ""
        raise RuntimeError(
            "Completed sales need an explicit prices_include_tax snapshot before upgrading "
            f"({ids}{suffix}). Upgrade first to 7f2a6c9e4b10, reconcile each sale from "
            "its real receipt/configuration, update sales.prices_include_tax, then continue."
        )

    op.create_check_constraint(
        _CONSTRAINT,
        "sales",
        "status <> 'COMPLETED' OR prices_include_tax IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f(f"ck_sales_{_CONSTRAINT}"), "sales", type_="check")
