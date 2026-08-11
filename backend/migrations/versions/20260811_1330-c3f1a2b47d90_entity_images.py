"""entity_images

La foto de un producto o de una categoría, en su propia tabla: los bytes
no tienen por qué viajar en cada listado, y una sola tabla sirve a los
tres dueños. Ver `app.catalog.models.EntityImage`.

Revision ID: c3f1a2b47d90
Revises: 2a69ea50f166
Create Date: 2026-08-11 13:30:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3f1a2b47d90"
down_revision: str | None = "2a69ea50f166"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "entity_images",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entity_type", "entity_id", name="uq_entity_images_owner"),
    )


def downgrade() -> None:
    # Se pierden las fotos, que es todo lo que hay aquí.
    op.drop_table("entity_images")
