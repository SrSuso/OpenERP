"""z_reports

El cierre de caja con sus totales congelados — ver `app.sales.z_reports`.

Revision ID: d7c4e8b91f52
Revises: c3f1a2b47d90
Create Date: 2026-08-11 19:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d7c4e8b91f52"
down_revision: str | None = "c3f1a2b47d90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MONEY = sa.Numeric(18, 6)


def upgrade() -> None:
    op.create_table(
        "z_reports",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("covers_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sales_count", sa.Integer(), nullable=False),
        sa.Column("gross_total", _MONEY, nullable=False),
        sa.Column("tax_total", _MONEY, nullable=False),
        sa.Column("discount_total", _MONEY, nullable=False),
        sa.Column("cash_total", _MONEY, nullable=False),
        sa.Column("card_total", _MONEY, nullable=False),
        sa.Column("other_total", _MONEY, nullable=False),
        sa.Column("returns_count", sa.Integer(), nullable=False),
        sa.Column("returns_total", _MONEY, nullable=False),
        sa.Column("closed_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.ForeignKeyConstraint(["closed_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("warehouse_id", "number", name="uq_z_reports_warehouse_number"),
    )
    op.create_index(op.f("ix_z_reports_warehouse_id"), "z_reports", ["warehouse_id"])


def downgrade() -> None:
    # Se pierden los cierres guardados, que es todo lo que hay aquí.
    op.drop_index(op.f("ix_z_reports_warehouse_id"), table_name="z_reports")
    op.drop_table("z_reports")
