"""Una huella de «cómo está ahora mismo todo lo que la caja enseña».

La caja está en otro equipo y no se toca en todo el día: si algo cambia en
el panel —un precio, un nombre, un botón del TPV, la foto de un producto—
tiene que verlo sola. Preguntar cada pocos segundos por el catálogo entero
sería caro; preguntar por esta huella cuesta cuatro `count`/`max` sobre
índices, y sólo cuando cambia se vuelve a pedir lo gordo.

No intenta decir *qué* ha cambiado. Es a propósito: cualquier cosa que
cambie tiene que hacerla distinta, y la caja responde siempre igual —
volver a preguntar—, así que no hay forma de que una tabla nueva se
quede fuera por olvidar un caso.
"""

from __future__ import annotations

import hashlib

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

#: Regla 13: los nombres de tabla salen de esta lista fija y de ningún
#: sitio más — nunca de la petición. Es lo que hace segura la consulta de
#: abajo, que sí se compone como texto.
#:
#: Están las que la caja enseña: los productos con sus formatos y códigos
#: de barras, sus categorías (las de estantería mandan el precio heredado,
#: las del TPV son los botones), las fotos, los ajustes de tienda y la
#: plantilla del ticket.
_WATCHED_TABLES = (
    "products",
    "product_packages",
    "product_barcodes",
    "product_categories",
    "pos_categories",
    "entity_images",
    "settings",
    "ticket_templates",
)


async def catalog_version(session: AsyncSession) -> str:
    """Cambia en cuanto se guarda, se crea o se borra cualquiera de esas
    filas: `max(updated_at)` recoge lo editado y `count(*)` lo borrado (que
    no deja rastro en ninguna fecha).

    Ojo con `updated_at`: lo pone el ORM al emitir el UPDATE
    (`TimestampMixin`), no un disparador de la base de datos. Una
    escritura en SQL crudo —una migración, un arreglo a mano con psql— no
    lo toca, y la caja no se enteraría hasta el siguiente cambio normal.
    Es aceptable porque la aplicación entera pasa por el ORM, pero conviene
    saberlo antes de arreglar precios a mano en producción."""
    parts: list[str] = []
    for table in _WATCHED_TABLES:
        row = (await session.execute(text(f"SELECT count(*), max(updated_at) FROM {table}"))).one()
        parts.append(f"{table}:{row[0]}:{row[1]}")
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]
