"""make Z reports final and move live totals to X reports

Revision ID: f2a6c9d8e4b1
Revises: e7f1a2b3c4d5
Create Date: 2026-09-05 09:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.rbac.permissions import PHASE_28_PERMISSIONS, PHASE_28_ROLE_GRANTS

revision: str = "f2a6c9d8e4b1"
down_revision: str | None = "e7f1a2b3c4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_permissions = sa.table(
    "permissions",
    sa.column("id", sa.BigInteger),
    sa.column("key", sa.String),
    sa.column("description", sa.String),
)
_roles = sa.table("roles", sa.column("id", sa.BigInteger), sa.column("name", sa.String))
_role_permissions = sa.table(
    "role_permissions",
    sa.column("role_id", sa.BigInteger),
    sa.column("permission_id", sa.BigInteger),
)


def upgrade() -> None:
    op.add_column("z_reports", sa.Column("business_date", sa.Date(), nullable=True))
    op.add_column(
        "z_reports",
        sa.Column("is_final", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("z_reports", sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "z_reports",
        sa.Column("warehouse_name", sa.String(length=100), nullable=False, server_default=""),
    )
    op.add_column(
        "z_reports",
        sa.Column("store_name", sa.String(length=500), nullable=False, server_default=""),
    )
    op.add_column(
        "z_reports",
        sa.Column("store_tax_id", sa.String(length=500), nullable=False, server_default=""),
    )
    op.add_column(
        "z_reports",
        sa.Column("store_address", sa.String(length=1000), nullable=False, server_default=""),
    )
    op.add_column("z_reports", sa.Column("closed_by_name", sa.String(length=255), nullable=True))
    op.add_column("z_reports", sa.Column("first_sale_number", sa.Integer(), nullable=True))
    op.add_column("z_reports", sa.Column("last_sale_number", sa.Integer(), nullable=True))
    for name in ("tax_breakdown", "payment_breakdown", "terminal_breakdown", "cashier_breakdown"):
        op.add_column(
            "z_reports",
            sa.Column(
                name,
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )

    # Historic reports came from the mutable daily-Z design. They remain
    # available as legacy records (is_final=false), rather than being
    # misrepresented as final fiscal documents. The local-date backfill is
    # only a lookup key for them; each new final Z records its exact business
    # day from the configured timezone in application code.
    op.execute(
        "UPDATE z_reports SET business_date = (closed_at AT TIME ZONE 'Europe/Madrid')::date "
        "WHERE business_date IS NULL"
    )
    op.alter_column("z_reports", "business_date", nullable=False)
    # La versión anterior volvía a guardar el mismo resumen mutable durante
    # el día. Se conserva sólo su última versión (por hora de cierre y, si
    # empatan, por id); las anteriores eran estados intermedios redundantes,
    # no cierres Z definitivos.
    op.execute(
        "DELETE FROM z_reports WHERE id IN ("
        "SELECT id FROM ("
        "SELECT id, row_number() OVER ("
        "PARTITION BY warehouse_id, business_date "
        "ORDER BY closed_at DESC, id DESC"
        ") AS row_number FROM z_reports"
        ") AS ranked WHERE row_number > 1"
        ")"
    )
    op.create_unique_constraint(
        "uq_z_reports_warehouse_business_date", "z_reports", ["warehouse_id", "business_date"]
    )
    # New reports are final by construction. `false` above only identifies
    # rows created by the historical mutable-Z implementation.
    op.alter_column("z_reports", "is_final", server_default=sa.text("true"))

    connection = op.get_bind()
    connection.execute(
        sa.insert(_permissions),
        [{"key": item.key, "description": item.description} for item in PHASE_28_PERMISSIONS],
    )
    permission_ids = dict(
        connection.execute(sa.select(_permissions.c.key, _permissions.c.id)).all()
    )
    role_ids = dict(connection.execute(sa.select(_roles.c.name, _roles.c.id)).all())
    connection.execute(
        sa.insert(_role_permissions),
        [
            {"role_id": role_ids[role_name], "permission_id": permission_ids[key]}
            for role_name, keys in PHASE_28_ROLE_GRANTS.items()
            for key in keys
        ],
    )


def downgrade() -> None:
    connection = op.get_bind()
    keys = [item.key for item in PHASE_28_PERMISSIONS]
    permission_ids = dict(
        connection.execute(sa.select(_permissions.c.key, _permissions.c.id)).all()
    )
    new_permission_ids = [permission_ids[key] for key in keys]
    connection.execute(
        _role_permissions.delete().where(_role_permissions.c.permission_id.in_(new_permission_ids))
    )
    connection.execute(_permissions.delete().where(_permissions.c.id.in_(new_permission_ids)))

    op.drop_constraint("uq_z_reports_warehouse_business_date", "z_reports", type_="unique")
    for name in ("cashier_breakdown", "terminal_breakdown", "payment_breakdown", "tax_breakdown"):
        op.drop_column("z_reports", name)
    op.drop_column("z_reports", "last_sale_number")
    op.drop_column("z_reports", "first_sale_number")
    op.drop_column("z_reports", "closed_by_name")
    op.drop_column("z_reports", "store_address")
    op.drop_column("z_reports", "store_tax_id")
    op.drop_column("z_reports", "store_name")
    op.drop_column("z_reports", "warehouse_name")
    op.drop_column("z_reports", "finalized_at")
    op.drop_column("z_reports", "is_final")
    op.drop_column("z_reports", "business_date")
