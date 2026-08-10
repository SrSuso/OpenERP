"""settings key/value table

Backs `app.settings.registry`: one row per option the shop has actually
changed, so adding a new configurable option never needs a migration.

Revision ID: 66b16b49cebd
Revises: 9f75060b3910
Create Date: 2026-08-10 17:46:13.899337+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "66b16b49cebd"
down_revision: str | None = "9f75060b3910"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "settings",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_settings")),
    )
    # `Setting.key` es `unique=True, index=True`: un único índice único, no
    # una restricción aparte más un índice normal (que es lo que `alembic
    # check` detectaría como desincronizado).
    op.create_index(op.f("ix_settings_key"), "settings", ["key"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_settings_key"), table_name="settings")
    op.drop_table("settings")
