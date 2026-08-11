"""El ticket se edita sólo en su plantilla

Los datos de la tienda, las etiquetas y los formatos que hasta ahora
vivían en Configuración pasan a ser columnas de `ticket_templates`. Los
valores que la tienda ya tuviera guardados se copian a todas sus
plantillas antes de borrarlos de `settings`, para que el ticket siga
saliendo igual que ayer.

Revision ID: e2b93a75c614
Revises: d7c4e8b91f52
Create Date: 2026-08-11 20:30:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2b93a75c614"
down_revision: str | None = "d7c4e8b91f52"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Columna nueva -> (tipo, valor por defecto, clave que tenía en `settings`).
_FIELDS: tuple[tuple[str, sa.types.TypeEngine[str], str, str], ...] = (
    ("store_name", sa.Text(), "", "store.name"),
    ("store_tax_id", sa.Text(), "", "store.tax_id"),
    ("store_address", sa.Text(), "", "store.address"),
    ("store_phone", sa.Text(), "", "store.phone"),
    ("sale_number_prefix", sa.String(50), "Venta #", "ticket.sale_number_prefix"),
    ("date_format", sa.String(50), "%Y-%m-%d %H:%M", "ticket.date_format"),
    ("label_total", sa.String(50), "TOTAL", "ticket.label_total"),
    ("label_change", sa.String(50), "Cambio", "ticket.label_change"),
    ("label_cash", sa.String(50), "Efectivo", "ticket.label_cash"),
    ("label_card", sa.String(50), "Tarjeta", "ticket.label_card"),
    ("label_other", sa.String(50), "Otros", "ticket.label_other"),
    ("label_discount", sa.String(50), "Dto.", "ticket.label_discount"),
    ("tax_note", sa.String(200), "IVA incluido", "ticket.tax_note"),
)

_FLAGS: tuple[tuple[str, str, str], ...] = (
    ("show_unit_price", "true", "ticket.show_unit_price"),
    ("show_cashier", "false", "ticket.show_cashier"),
)


def upgrade() -> None:
    for column, type_, default, _key in _FIELDS:
        op.add_column(
            "ticket_templates",
            sa.Column(column, type_, nullable=False, server_default=default),
        )
    for column, default, _key in _FLAGS:
        op.add_column(
            "ticket_templates",
            sa.Column(column, sa.Boolean(), nullable=False, server_default=default),
        )

    # Lo que la tienda tuviera puesto se lleva a sus plantillas: sin esto,
    # el primer ticket después de actualizar saldría con los valores de
    # fábrica y sin los datos de la tienda.
    connection = op.get_bind()
    for column, _type, _default, key in _FIELDS:
        connection.execute(
            sa.text(
                f"UPDATE ticket_templates SET {column} = s.value FROM settings s WHERE s.key = :key"
            ),
            {"key": key},
        )
    for column, _default, key in _FLAGS:
        connection.execute(
            sa.text(
                f"UPDATE ticket_templates SET {column} = (s.value = 'true') "
                "FROM settings s WHERE s.key = :key"
            ),
            {"key": key},
        )

    keys = [key for *_rest, key in _FIELDS] + [key for *_rest, key in _FLAGS]
    connection.execute(sa.text("DELETE FROM settings WHERE key = ANY(:keys)"), {"keys": keys})


def downgrade() -> None:
    # Los valores vuelven a `settings` desde la plantilla activa, que es de
    # donde salían: se pierde el haberlos podido tener distintos en dos
    # plantillas, que es justo lo que esta migración añadía.
    connection = op.get_bind()
    for column, _type, _default, key in _FIELDS:
        connection.execute(
            sa.text(
                "INSERT INTO settings (key, value, created_at, updated_at) "
                f"SELECT :key, {column}, now(), now() FROM ticket_templates "
                "WHERE is_active = true LIMIT 1 "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
            ),
            {"key": key},
        )
    for column, _default, key in _FLAGS:
        connection.execute(
            sa.text(
                "INSERT INTO settings (key, value, created_at, updated_at) "
                f"SELECT :key, CASE WHEN {column} THEN 'true' ELSE 'false' END, "
                "now(), now() FROM ticket_templates WHERE is_active = true LIMIT 1 "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
            ),
            {"key": key},
        )

    for column, *_rest in _FIELDS:
        op.drop_column("ticket_templates", column)
    for column, *_rest in _FLAGS:
        op.drop_column("ticket_templates", column)
