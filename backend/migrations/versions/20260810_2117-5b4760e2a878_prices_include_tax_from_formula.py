"""prices_include_tax deducido de la fórmula

Arregla, sin intervención manual, una tienda cuyo PVP ya lleva el IVA.

Si la fórmula del PVP usa `tax_rate`, el precio que sale de ella **ya
contiene** el impuesto (`(cost + cost*tax_rate/100 + ...) * margen`, que
es la fórmula de fábrica). En ese caso la caja no puede volver a sumarlo:
un producto etiquetado a 15,14 € tiene que cobrarse a 15,14 €, no a
18,32 €. Cobrar el impuesto dos veces no es correcto en ningún régimen,
así que deducirlo de la fórmula es seguro y no hay ningún caso legítimo
que esta migración estropee.

Una tienda en régimen general —que deduce el IVA soportado y por tanto
parte de un coste neto— tiene una fórmula sin `tax_rate` (`cost * (1 +
margen/100)`), no entra aquí, y sigue sumando el IVA en caja como hasta
ahora.

Hacía falta porque la línea de venta pasó a guardar el tipo de IVA
efectivo (necesario para poder desglosarlo en el ticket); antes valía 0
por un descuido y el total salía bien de casualidad. Con el tipo ya
correcto, este ajuste es lo único que separa cobrar bien de cobrar un
21% de más.

Revision ID: 5b4760e2a878
Revises: 66b16b49cebd
Create Date: 2026-08-10 21:17:33.170033+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "5b4760e2a878"
down_revision: str | None = "66b16b49cebd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE pricing_settings SET prices_include_tax = true WHERE formula LIKE '%tax_rate%'"
    )


def downgrade() -> None:
    # Irreversible a propósito: no se puede distinguir a quién puso este
    # ajuste esta migración de quien ya lo tenía activado a mano, y
    # revertirlo volvería a cobrar el impuesto dos veces.
    pass
