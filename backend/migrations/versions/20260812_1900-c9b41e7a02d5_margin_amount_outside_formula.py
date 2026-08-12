"""El margen en euros sale de la fórmula y se suma aparte

b6d20f8a4c91 lo metió como una variable más y le añadió `+ margin_amount`
a la fórmula de fábrica. Con eso, poner 25 céntimos en una categoría no
hacía nada si la fórmula no lo nombraba — y no lo nombra ninguna fórmula
escrita a mano, ni la que ya tuviera un producto de antes. Silencioso y
justo al revés de lo que se espera.

Ahora se suma fuera de la fórmula, siempre
(`app.pricing.service._recompute_with`), así que hay que quitar el
`+ margin_amount` que aquella migración dejó puesto: si no, contaría dos
veces. Se le quita a cualquier fórmula que acabe así, no sólo a la de
fábrica, porque la variable ya no existe y una fórmula que la nombre deja
de poder evaluarse.

Revision ID: c9b41e7a02d5
Revises: b6d20f8a4c91
Create Date: 2026-08-12 19:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9b41e7a02d5"
down_revision: str | None = "b6d20f8a4c91"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SUFFIX = " + margin_amount"


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE pricing_settings SET formula = left(formula, -:n) WHERE formula LIKE :pattern"
        ).bindparams(n=len(_SUFFIX), pattern=f"%{_SUFFIX}")
    )


def downgrade() -> None:
    # Se lo devuelve sólo a la de fábrica: es la única a la que b6d20f8a4c91
    # se lo puso.
    seeded = (
        "(cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)"
    )
    op.execute(
        sa.text("UPDATE pricing_settings SET formula = :new WHERE formula = :old").bindparams(
            new=f"{seeded}{_SUFFIX}", old=seeded
        )
    )
