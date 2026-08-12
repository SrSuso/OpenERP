"""Margen en euros y fórmula heredable de la categoría

Hasta ahora el precio sólo se podía sacar con un margen en porcentaje (o
con una fórmula escrita a mano, y sólo producto a producto). En una tienda
hay artículos que se marcan «veinticinco céntimos por encima de lo que me
cuesta» y no en tanto por ciento, así que el margen en dinero es una forma
de precio más, con la misma herencia que el porcentaje: producto →
categoría → nada. Y la fórmula pasa a poder ponerse también en la
categoría, para no repetirla en cada producto de la misma familia.

El margen fijo se guarda como dato propio. No se introduce en el texto de
ninguna fórmula: el servicio de precios lo suma después de evaluarla, tanto
para fórmulas sembradas como personalizadas.

Revision ID: b6d20f8a4c91
Revises: a8e5d0c31746
Create Date: 2026-08-12 16:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b6d20f8a4c91"
down_revision: str | None = "a8e5d0c31746"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nulo = «aquí no se dice nada» (no es lo mismo que 0 €), igual que
    # margin_rate: así nada de lo que ya existe cambia de precio.
    op.add_column(
        "product_categories", sa.Column("margin_amount", sa.Numeric(18, 6), nullable=True)
    )
    op.add_column("product_categories", sa.Column("price_formula", sa.String(500), nullable=True))
    op.add_column("products", sa.Column("margin_amount", sa.Numeric(18, 6), nullable=True))
    # En el histórico sí es 0 y no nulo: esas filas se calcularon sin esta
    # forma de precio, así que aportó exactamente 0 €.
    op.add_column(
        "product_price_history",
        sa.Column("margin_amount", sa.Numeric(18, 6), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("product_price_history", "margin_amount")
    op.drop_column("products", "margin_amount")
    op.drop_column("product_categories", "price_formula")
    op.drop_column("product_categories", "margin_amount")
