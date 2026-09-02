"""preserve manually fixed product prices during automatic recalculation

Revision ID: d5e8f1a2b3c4
Revises: c7d1e5a9b3f2
Create Date: 2026-09-03 01:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5e8f1a2b3c4"
down_revision: str | None = "c7d1e5a9b3f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "manual_price_is_set",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # A legacy product did not store its pricing mode.  Recover it whenever
    # the append-only audit trail has an explicit manual action more recent
    # than a later automatic-mode action.  Rows without such evidence keep
    # their established automatic behaviour.
    op.execute(
        """
        UPDATE products AS product
        SET manual_price_is_set = true
        WHERE EXISTS (
            SELECT 1
            FROM audit_log AS manual_action
            WHERE manual_action.entity_type = 'product'
              AND manual_action.entity_id = product.id
              AND manual_action.action = 'manual_price_set'
              AND NOT EXISTS (
                  SELECT 1
                  FROM audit_log AS automatic_action
                  WHERE automatic_action.entity_type = 'product'
                    AND automatic_action.entity_id = product.id
                    AND automatic_action.action IN ('manual_price_cleared', 'formula_set')
                    AND automatic_action.id > manual_action.id
              )
        )
        """
    )


def downgrade() -> None:
    op.drop_column("products", "manual_price_is_set")
