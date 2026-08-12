"""prices_include_tax explícito, salvo la fórmula sembrada conocida

La fórmula exacta sembrada por 20412e4e301c sí tiene semántica conocida:
incluye ``tax_rate``, por lo que se marca como precio con impuesto. Para
cualquier fórmula personalizada, buscar el nombre de una variable no basta
para conocer su semántica; la actualización se detiene y pide que el valor
se establezca explícitamente en la revisión anterior.

Revision ID: 5b4760e2a878
Revises: 66b16b49cebd
Create Date: 2026-08-10 21:17:33.170033+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5b4760e2a878"
down_revision: str | None = "66b16b49cebd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SEEDED_FORMULA = (
    "(cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)"
)


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE pricing_settings SET prices_include_tax = true "
            "WHERE prices_include_tax IS NULL AND formula = :seeded"
        ).bindparams(seeded=_SEEDED_FORMULA)
    )
    unresolved = (
        connection.execute(
            sa.text("SELECT id FROM pricing_settings WHERE prices_include_tax IS NULL ORDER BY id")
        )
        .scalars()
        .all()
    )
    if unresolved:
        ids = ", ".join(str(item) for item in unresolved)
        raise RuntimeError(
            "Cannot infer prices_include_tax for customized pricing settings "
            f"({ids}). Stay on revision 547ee9f06037, set the value explicitly, then retry."
        )
    op.alter_column(
        "pricing_settings",
        "prices_include_tax",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("false"),
    )


def downgrade() -> None:
    op.alter_column(
        "pricing_settings",
        "prices_include_tax",
        existing_type=sa.Boolean(),
        nullable=True,
        server_default=None,
    )
