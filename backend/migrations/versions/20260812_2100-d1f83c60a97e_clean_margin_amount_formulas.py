"""Quitar `margin_amount` de las fórmulas que lo tengan escrito

c9b41e7a02d5 sacó el margen en euros de la fórmula (ahora se suma aparte) y
le quitó el `+ margin_amount` a la de la tienda. Pero la ayuda del panel lo
listó un rato como variable, así que puede haber quedado escrito a mano en
la fórmula propia de un producto o de una categoría.

Esa fórmula ya no se puede evaluar: `margin_amount` no existe como
variable, y el recálculo del precio falla con un 422. No es un fallo
llamativo — es un producto al que, de pronto, no se le puede tocar el
precio, y una categoría que arrastra a todos los suyos.

Se limpia así:

- Producto y categoría: se les quita la fórmula propia (queda a nulo).
  Vuelven a la que heredan —la de su categoría o la de la tienda—, y el
  margen en euros se les sigue aplicando igual, porque ahora va por fuera.
- La de la tienda no puede quedar vacía, así que si todavía la nombra se
  devuelve a la de fábrica. Es lo único que se puede hacer: dejarla rota
  impediría recalcular ni un solo precio en toda la tienda.

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

_SEEDED_FORMULA = (
    "(cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)"
)


def upgrade() -> None:
    # Los dos nombres de tabla salen de esta lista fija y de ningún sitio
    # más — nunca de una petición (regla 13).
    for table in ("products", "product_categories"):
        op.execute(
            sa.text(
                f"UPDATE {table} SET price_formula = NULL "
                "WHERE price_formula LIKE '%margin_amount%'"
            )
        )
    op.execute(
        sa.text(
            "UPDATE pricing_settings SET formula = :seeded WHERE formula LIKE :pattern"
        ).bindparams(seeded=_SEEDED_FORMULA, pattern="%margin_amount%")
    )


def downgrade() -> None:
    """No hay vuelta: lo que se ha quitado no se sabe cómo estaba escrito,
    y devolverlo dejaría fórmulas que no se pueden evaluar. Deshacer *esta*
    migración no rompe nada — las fórmulas heredadas siguen funcionando."""
