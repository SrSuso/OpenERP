"""El margen en euros se calcula fuera de la fórmula

b6d20f8a4c91 se ha saneado antes del primer despliegue para no modificar
textos de fórmula. Esta revisión queda como hito compatible de la cadena;
la aplicación suma siempre el margen fijo mediante
``app.pricing.service._recompute_with``.

Revision ID: c9b41e7a02d5
Revises: b6d20f8a4c91
Create Date: 2026-08-12 19:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "c9b41e7a02d5"
down_revision: str | None = "b6d20f8a4c91"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
