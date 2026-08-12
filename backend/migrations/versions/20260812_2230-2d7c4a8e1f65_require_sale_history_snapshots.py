"""require complete snapshots for sale history

Revision ID: 2d7c4a8e1f65
Revises: 9a3e6b1c7d42
Create Date: 2026-08-12 22:30:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection
from sqlalchemy.types import TypeEngine

revision: str = "2d7c4a8e1f65"
down_revision: str | None = "9a3e6b1c7d42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CASHIER_CONSTRAINT = "completed_has_cashier_snapshot"
_REQUIRED_LINE_COLUMNS = (
    "product_sku",
    "product_name",
    "unit_cost",
    "tracks_stock",
    "track_lots",
)


def _sample_ids(connection: Connection, query: str) -> list[int]:
    return list(connection.execute(sa.text(query)).scalars().all())


def _fail_with_ids(message: str, ids: list[int]) -> None:
    rendered = ", ".join(str(item) for item in ids[:20])
    suffix = "..." if len(ids) > 20 else ""
    raise RuntimeError(f"{message} ({rendered}{suffix}).")


def upgrade() -> None:
    connection = op.get_bind()
    missing_cashiers = _sample_ids(
        connection,
        "SELECT id FROM sales WHERE status = 'COMPLETED' "
        "AND cashier_user_id IS NOT NULL AND cashier_name IS NULL ORDER BY id",
    )
    if missing_cashiers:
        _fail_with_ids(
            "Completed sales need their real cashier_name snapshot before upgrading",
            missing_cashiers,
        )

    missing_lines = _sample_ids(
        connection,
        "SELECT id FROM sale_lines WHERE "
        + " OR ".join(f"{column} IS NULL" for column in _REQUIRED_LINE_COLUMNS)
        + " ORDER BY id",
    )
    if missing_lines:
        _fail_with_ids(
            "Sale lines need explicit historical product/cost/stock snapshots before upgrading; "
            "upgrade first to 9a3e6b1c7d42, reconcile them, then continue",
            missing_lines,
        )

    op.create_check_constraint(
        _CASHIER_CONSTRAINT,
        "sales",
        "status <> 'COMPLETED' OR cashier_user_id IS NULL OR cashier_name IS NOT NULL",
    )
    for column in _REQUIRED_LINE_COLUMNS:
        existing_type: TypeEngine
        if column in {"product_sku", "product_name"}:
            existing_type = sa.String(length=50 if column == "product_sku" else 255)
        elif column == "unit_cost":
            existing_type = sa.Numeric(precision=18, scale=6)
        else:
            existing_type = sa.Boolean()
        op.alter_column("sale_lines", column, existing_type=existing_type, nullable=False)


def downgrade() -> None:
    for column in reversed(_REQUIRED_LINE_COLUMNS):
        existing_type: TypeEngine
        if column in {"product_sku", "product_name"}:
            existing_type = sa.String(length=50 if column == "product_sku" else 255)
        elif column == "unit_cost":
            existing_type = sa.Numeric(precision=18, scale=6)
        else:
            existing_type = sa.Boolean()
        op.alter_column("sale_lines", column, existing_type=existing_type, nullable=True)
    op.drop_constraint(op.f(f"ck_sales_{_CASHIER_CONSTRAINT}"), "sales", type_="check")
