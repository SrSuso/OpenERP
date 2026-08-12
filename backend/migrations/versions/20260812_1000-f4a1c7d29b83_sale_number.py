"""El número de venta que se imprime, y fuera las canceladas

El `id` se reparte al abrir el carrito, así que cada carrito que no llega
a cobrarse deja un hueco en la numeración del ticket. Se añade `number`,
que se asigna al cobrar y va correlativo.

Las ventas canceladas se borran: a partir de ahora cancelar borra el
carrito (no ha tocado stock, ni cobro, ni ticket), y las que quedaran de
antes se van por el mismo motivo — no tienen nada colgando.

Revision ID: f4a1c7d29b83
Revises: e2b93a75c614
Create Date: 2026-08-12 10:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4a1c7d29b83"
down_revision: str | None = "e2b93a75c614"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()

    # Primero las canceladas: así no se llevan un número al numerar.
    connection.execute(
        sa.text(
            "DELETE FROM sale_lines WHERE sale_id IN "
            "(SELECT id FROM sales WHERE status = 'CANCELLED')"
        )
    )
    connection.execute(sa.text("DELETE FROM sales WHERE status = 'CANCELLED'"))

    op.add_column("sales", sa.Column("number", sa.Integer(), nullable=True))
    # Las que ya estaban cobradas se numeran por orden de cobro, que es el
    # orden en que se dieron los tickets.
    connection.execute(
        sa.text(
            "UPDATE sales SET number = numbered.row_number FROM ("
            "  SELECT id, row_number() OVER (ORDER BY completed_at, id) AS row_number"
            "  FROM sales WHERE status = 'COMPLETED'"
            ") AS numbered WHERE sales.id = numbered.id"
        )
    )
    op.create_unique_constraint("uq_sales_number", "sales", ["number"])


def downgrade() -> None:
    op.drop_constraint("uq_sales_number", "sales", type_="unique")
    op.drop_column("sales", "number")
