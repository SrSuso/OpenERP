"""Si un producto lleva control de existencias, o no se agota nunca.

Lo que se vende a granel —fruta, verdura, carne— se repone del saco o de
la cámara sin contar nada, así que llevarle un stock exacto obliga a
ajustarlo a mano cada mañana para que la caja no se plante a media
mañana. Apagándolo, la venta no comprueba existencias ni mueve el
almacén: ese producto no se agota.

No vale hacerlo por unidad de medida: en la misma tienda hay kilos que se
cuentan (un queso caro) y kilos que no (las patatas). Por eso se elige
producto a producto, con la categoría como valor por defecto — la misma
prioridad que el margen y los impuestos (`app.catalog.taxes`).
"""

from __future__ import annotations

from app.catalog.models import Product


def tracks_stock(product: Product) -> bool:
    """Lo que diga el producto; si no dice nada, su categoría; y sin
    categoría, se controla (que es lo prudente)."""
    if product.tracks_stock is not None:
        return product.tracks_stock
    if product.category is not None:
        return product.category.tracks_stock
    return True
