"""Control de existencias, elegible por producto o por categoría

Lo que se vende a granel se repone del saco sin contar nada, así que
llevarle un stock exacto obliga a ajustarlo a mano cada mañana para que la
caja no se plante. Se puede apagar por producto, con la categoría como
valor por defecto — misma prioridad que el margen y los impuestos.

Revision ID: a8e5d0c31746
Revises: f4a1c7d29b83
Create Date: 2026-08-12 12:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8e5d0c31746"
down_revision: str | None = "f4a1c7d29b83"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "product_categories",
        sa.Column("tracks_stock", sa.Boolean(), nullable=False, server_default="true"),
    )
    # Nulo en el producto = lo que diga su categoría, que es como nace todo
    # lo que ya existe: nada cambia de comportamiento al actualizar.
    op.add_column("products", sa.Column("tracks_stock", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "tracks_stock")
    op.drop_column("product_categories", "tracks_stock")
