"""rechazar fórmulas antiguas con `margin_amount` sin destruirlas

Durante preproducción la ayuda llegó a presentar ``margin_amount`` como una
variable. Su uso puede ser arbitrario, así que eliminar la fórmula o hacer
una sustitución textual inventaría una regla de precio. La migración se
detiene, informa de las filas y conserva los textos para que se reescriban
explícitamente en la revisión anterior.

Revision ID: d1f83c60a97e
Revises: c9b41e7a02d5
Create Date: 2026-08-12 21:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d1f83c60a97e"
down_revision: str | None = "c9b41e7a02d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    affected: list[str] = []
    for table, column in (
        ("products", "price_formula"),
        ("product_categories", "price_formula"),
        ("pricing_settings", "formula"),
    ):
        ids = (
            connection.execute(
                sa.text(
                    f"SELECT id FROM {table} WHERE {column} LIKE :pattern ORDER BY id"
                ).bindparams(pattern="%margin_amount%")
            )
            .scalars()
            .all()
        )
        if ids:
            affected.append(f"{table}: {', '.join(str(item) for item in ids)}")
    if affected:
        raise RuntimeError(
            "Formulas using margin_amount require explicit review before upgrading; "
            "no values were changed. " + "; ".join(affected)
        )


def downgrade() -> None:
    pass
