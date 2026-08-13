"""separate return quantities and persist refunds

Revision ID: 6a4d2f8c1b73
Revises: 3e7b1c9d5a42
Create Date: 2026-08-13 17:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6a4d2f8c1b73"
down_revision: str | None = "3e7b1c9d5a42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NUMERIC = sa.Numeric(precision=18, scale=6)

_RETURN_LINE_CHECKS = {
    "refund_quantity_packages_non_negative": "refund_quantity_packages >= 0",
    "refund_quantity_base_non_negative": "refund_quantity_base >= 0",
    "stock_return_quantity_packages_non_negative": "stock_return_quantity_packages >= 0",
    "stock_return_quantity_base_non_negative": "stock_return_quantity_base >= 0",
    "has_economic_or_physical_quantity": (
        "refund_quantity_base > 0 OR stock_return_quantity_base > 0"
    ),
    "refund_amount_non_negative": "refund_amount >= 0",
}

_SALE_LINE_CHECKS = {
    "quantity_refunded_non_negative": "quantity_refunded >= 0",
    "quantity_refunded_not_above_sold": "quantity_refunded <= quantity_base",
    "quantity_physically_returned_non_negative": "quantity_physically_returned >= 0",
    "quantity_physically_returned_not_above_sold": (
        "quantity_physically_returned <= quantity_base"
    ),
}


def upgrade() -> None:
    connection = op.get_bind()

    # The old flags make every historical combination unambiguous:
    # economic only -> (old quantity, 0), physical only -> (0, old quantity),
    # both -> (old quantity, old quantity).
    op.add_column("return_lines", sa.Column("refund_quantity_packages", _NUMERIC, nullable=True))
    op.add_column("return_lines", sa.Column("refund_quantity_base", _NUMERIC, nullable=True))
    op.add_column(
        "return_lines", sa.Column("stock_return_quantity_packages", _NUMERIC, nullable=True)
    )
    op.add_column("return_lines", sa.Column("stock_return_quantity_base", _NUMERIC, nullable=True))
    connection.execute(
        sa.text(
            "UPDATE return_lines SET "
            "refund_quantity_packages = CASE WHEN is_economic THEN quantity_packages ELSE 0 END, "
            "refund_quantity_base = CASE WHEN is_economic THEN quantity_base ELSE 0 END, "
            "stock_return_quantity_packages = "
            "CASE WHEN is_physical THEN quantity_packages ELSE 0 END, "
            "stock_return_quantity_base = CASE WHEN is_physical THEN quantity_base ELSE 0 END"
        )
    )
    invalid_ids = list(
        connection.execute(
            sa.text(
                "SELECT id FROM return_lines WHERE refund_quantity_base = 0 "
                "AND stock_return_quantity_base = 0 ORDER BY id LIMIT 20"
            )
        ).scalars()
    )
    if invalid_ids:
        rendered = ", ".join(str(item) for item in invalid_ids)
        raise RuntimeError(
            "Legacy return lines with neither an economic nor physical effect need explicit "
            f"reconciliation before upgrading ({rendered})."
        )
    for column in (
        "refund_quantity_packages",
        "refund_quantity_base",
        "stock_return_quantity_packages",
        "stock_return_quantity_base",
    ):
        op.alter_column("return_lines", column, existing_type=_NUMERIC, nullable=False)
    for name, condition in _RETURN_LINE_CHECKS.items():
        op.create_check_constraint(name, "return_lines", condition)

    op.add_column(
        "sale_lines",
        sa.Column("quantity_refunded", _NUMERIC, server_default="0", nullable=False),
    )
    op.add_column(
        "sale_lines",
        sa.Column("quantity_physically_returned", _NUMERIC, server_default="0", nullable=False),
    )
    connection.execute(
        sa.text(
            "UPDATE sale_lines AS sl SET "
            "quantity_refunded = totals.refunded, "
            "quantity_physically_returned = totals.physical "
            "FROM ("
            "SELECT sale_line_id, SUM(refund_quantity_base) AS refunded, "
            "SUM(stock_return_quantity_base) AS physical "
            "FROM return_lines GROUP BY sale_line_id"
            ") AS totals WHERE totals.sale_line_id = sl.id"
        )
    )
    for name, condition in _SALE_LINE_CHECKS.items():
        op.create_check_constraint(name, "sale_lines", condition)

    op.create_table(
        "refunds",
        sa.Column("return_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", _NUMERIC, nullable=False),
        # NULL is deliberately retained for migrated history: the legacy
        # application never persisted the real refund method.
        sa.Column("method", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="COMPLETED", nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
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
        sa.CheckConstraint("amount >= 0", name=op.f("ck_refunds_amount_non_negative")),
        sa.CheckConstraint(
            "method IS NULL OR method IN ('CASH', 'CARD', 'OTHER')",
            name=op.f("ck_refunds_supported_method"),
        ),
        sa.CheckConstraint("status = 'COMPLETED'", name=op.f("ck_refunds_supported_status")),
        sa.CheckConstraint(
            "status <> 'COMPLETED' OR completed_at IS NOT NULL",
            name=op.f("ck_refunds_completed_has_timestamp"),
        ),
        sa.ForeignKeyConstraint(
            ["processed_by_user_id"],
            ["users.id"],
            name=op.f("fk_refunds_processed_by_user_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["return_id"], ["returns.id"], name=op.f("fk_refunds_return_id_returns")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refunds")),
        sa.UniqueConstraint("return_id", name="uq_refunds_return_id"),
    )
    connection.execute(
        sa.text(
            "INSERT INTO refunds "
            "(return_id, amount, method, status, completed_at, processed_by_user_id, "
            "created_at, updated_at) "
            "SELECT r.id, SUM(rl.refund_amount), NULL, 'COMPLETED', r.created_at, "
            "r.processed_by_user_id, r.created_at, r.updated_at "
            "FROM returns AS r JOIN return_lines AS rl ON rl.return_id = r.id "
            "WHERE rl.refund_quantity_base > 0 "
            "GROUP BY r.id, r.created_at, r.updated_at, r.processed_by_user_id"
        )
    )

    op.drop_column("sale_lines", "quantity_returned")
    op.drop_column("return_lines", "is_physical")
    op.drop_column("return_lines", "is_economic")
    op.drop_column("return_lines", "quantity_base")
    op.drop_column("return_lines", "quantity_packages")


def downgrade() -> None:
    connection = op.get_bind()
    incompatible_ids = list(
        connection.execute(
            sa.text(
                "SELECT id FROM return_lines WHERE refund_quantity_base > 0 "
                "AND stock_return_quantity_base > 0 "
                "AND refund_quantity_base <> stock_return_quantity_base ORDER BY id LIMIT 20"
            )
        ).scalars()
    )
    if incompatible_ids:
        rendered = ", ".join(str(item) for item in incompatible_ids)
        raise RuntimeError(
            "Cannot downgrade independent economic/physical quantities without data loss; "
            f"reconcile return_lines first ({rendered})."
        )

    op.add_column("return_lines", sa.Column("quantity_packages", _NUMERIC, nullable=True))
    op.add_column("return_lines", sa.Column("quantity_base", _NUMERIC, nullable=True))
    op.add_column(
        "return_lines",
        sa.Column("is_economic", sa.Boolean(), server_default="true", nullable=False),
    )
    op.add_column(
        "return_lines",
        sa.Column("is_physical", sa.Boolean(), server_default="true", nullable=False),
    )
    connection.execute(
        sa.text(
            "UPDATE return_lines SET "
            "quantity_packages = GREATEST(refund_quantity_packages, "
            "stock_return_quantity_packages), "
            "quantity_base = GREATEST(refund_quantity_base, stock_return_quantity_base), "
            "is_economic = refund_quantity_base > 0, "
            "is_physical = stock_return_quantity_base > 0"
        )
    )
    op.alter_column("return_lines", "quantity_packages", existing_type=_NUMERIC, nullable=False)
    op.alter_column("return_lines", "quantity_base", existing_type=_NUMERIC, nullable=False)

    op.add_column(
        "sale_lines",
        sa.Column("quantity_returned", _NUMERIC, server_default="0", nullable=False),
    )
    connection.execute(
        sa.text(
            "UPDATE sale_lines AS sl SET quantity_returned = totals.returned "
            "FROM (SELECT sale_line_id, SUM(GREATEST(refund_quantity_base, "
            "stock_return_quantity_base)) AS returned FROM return_lines GROUP BY sale_line_id) "
            "AS totals WHERE totals.sale_line_id = sl.id"
        )
    )

    op.drop_table("refunds")
    for name in reversed(tuple(_SALE_LINE_CHECKS)):
        op.drop_constraint(op.f(f"ck_sale_lines_{name}"), "sale_lines", type_="check")
    op.drop_column("sale_lines", "quantity_physically_returned")
    op.drop_column("sale_lines", "quantity_refunded")
    for name in reversed(tuple(_RETURN_LINE_CHECKS)):
        op.drop_constraint(op.f(f"ck_return_lines_{name}"), "return_lines", type_="check")
    op.drop_column("return_lines", "stock_return_quantity_base")
    op.drop_column("return_lines", "stock_return_quantity_packages")
    op.drop_column("return_lines", "refund_quantity_base")
    op.drop_column("return_lines", "refund_quantity_packages")
