"""add POS terminals and associate sales

Revision ID: 3e7b1c9d5a42
Revises: 8c4e2a7f1b93
Create Date: 2026-08-13 13:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3e7b1c9d5a42"
down_revision: str | None = "8c4e2a7f1b93"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pos_terminals",
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
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
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(
            ["warehouse_id"],
            ["warehouses.id"],
            name=op.f("fk_pos_terminals_warehouse_id_warehouses"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pos_terminals")),
        sa.UniqueConstraint(
            "warehouse_id", "name", name="uq_pos_terminals_warehouse_id_name"
        ),
    )
    op.create_index(
        op.f("ix_pos_terminals_warehouse_id"),
        "pos_terminals",
        ["warehouse_id"],
        unique=False,
    )
    op.add_column("sales", sa.Column("terminal_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        op.f("fk_sales_terminal_id_pos_terminals"),
        "sales",
        "pos_terminals",
        ["terminal_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_sales_terminal_id_status", "sales", ["terminal_id", "status"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_sales_terminal_id_status", table_name="sales")
    op.drop_constraint(
        op.f("fk_sales_terminal_id_pos_terminals"), "sales", type_="foreignkey"
    )
    op.drop_column("sales", "terminal_id")
    op.drop_index(op.f("ix_pos_terminals_warehouse_id"), table_name="pos_terminals")
    op.drop_table("pos_terminals")
