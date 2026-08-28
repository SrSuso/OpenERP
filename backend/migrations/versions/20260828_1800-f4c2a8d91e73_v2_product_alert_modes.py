"""make product alerts explicit and purge the V1 rule engine

Revision ID: f4c2a8d91e73
Revises: e8b3c7d5a2f1
Create Date: 2026-08-28 18:00:00.000000+00:00
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation

import sqlalchemy as sa
from alembic import op

revision: str = "f4c2a8d91e73"
down_revision: str | None = "e8b3c7d5a2f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _old_general_minimum(connection: sa.Connection) -> Decimal:
    raw = connection.execute(
        sa.text("SELECT value FROM settings WHERE key = 'catalog.default_min_stock'")
    ).scalar_one_or_none()
    if raw is None:
        return Decimal(0)
    try:
        value = Decimal(str(raw))
    except InvalidOperation:
        return Decimal(0)
    return value if value >= 0 else Decimal(0)


def upgrade() -> None:
    connection = op.get_bind()
    general_minimum = _old_general_minimum(connection)

    op.add_column(
        "products",
        sa.Column("stock_alert_mode", sa.String(length=10), nullable=True),
    )
    # Preserve the previous behaviour exactly. Existing zero thresholds stay
    # silent; only products with a real threshold become CUSTOM.
    connection.execute(
        sa.text(
            "UPDATE products SET stock_alert_mode = "
            "CASE WHEN min_stock > 0 THEN 'CUSTOM' ELSE 'DISABLED' END"
        )
    )
    op.alter_column(
        "products",
        "stock_alert_mode",
        existing_type=sa.String(length=10),
        nullable=False,
        server_default="GENERAL",
    )
    op.create_check_constraint(
        "ck_products_stock_alert_mode",
        "products",
        "stock_alert_mode IN ('GENERAL', 'CUSTOM', 'DISABLED')",
    )

    # Keep exactly one V2-managed stock rule. Everything else belongs to the
    # public V1 rule editor and is removed together with its incidents.
    kept_low_id = connection.execute(
        sa.text(
            "SELECT id FROM notification_rules "
            "WHERE rule_type = 'LOW_STOCK' AND params->>'automatic' = 'true' "
            "ORDER BY id LIMIT 1"
        )
    ).scalar_one_or_none()
    stock_params = {
        "automatic": True,
        "warehouse_id": None,
        "enabled": general_minimum > 0,
        "min_stock": str(general_minimum),
    }
    if kept_low_id is None:
        kept_low_id = connection.execute(
            sa.text(
                "INSERT INTO notification_rules "
                "(name, rule_type, params, severity, is_active) "
                "VALUES ('Avisos de stock', 'LOW_STOCK', CAST(:params AS jsonb), "
                "'MEDIUM_HIGH', true) RETURNING id"
            ),
            {"params": json.dumps(stock_params)},
        ).scalar_one()
    else:
        connection.execute(
            sa.text(
                "UPDATE notification_rules SET name = 'Avisos de stock', "
                "params = CAST(:params AS jsonb), is_active = true, updated_at = now() "
                "WHERE id = :rule_id"
            ),
            {"params": json.dumps(stock_params), "rule_id": kept_low_id},
        )

    # For expiration, managed=true is the V2 identity. Keep one deterministic
    # row for the general setting and one per product exception.
    kept_expiration_ids = list(
        connection.execute(
            sa.text(
                "SELECT id FROM ("
                " SELECT id, row_number() OVER ("
                "   PARTITION BY COALESCE(params->>'product_id', '__general__') ORDER BY id"
                " ) AS position"
                " FROM notification_rules"
                " WHERE rule_type = 'EXPIRING_LOT' AND params->>'managed' = 'true'"
                ") managed WHERE position = 1 ORDER BY id"
            )
        ).scalars()
    )
    kept_rule_ids = [kept_low_id, *kept_expiration_ids]
    connection.execute(
        sa.text("DELETE FROM incidents WHERE rule_id != ALL(:kept_rule_ids)"),
        {"kept_rule_ids": kept_rule_ids},
    )
    connection.execute(
        sa.text("DELETE FROM notification_rules WHERE id != ALL(:kept_rule_ids)"),
        {"kept_rule_ids": kept_rule_ids},
    )
    connection.execute(
        sa.text(
            "DELETE FROM settings WHERE key IN "
            "('catalog.default_min_stock', 'notifications.default_expiration_days')"
        )
    )


def downgrade() -> None:
    # Purged V1 rules cannot be recreated safely: their arbitrary conditions
    # and incidents were user data. The product threshold itself is retained,
    # so old code continues to behave correctly for CUSTOM products.
    op.drop_constraint("ck_products_stock_alert_mode", "products", type_="check")
    op.drop_column("products", "stock_alert_mode")
