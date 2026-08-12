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

from sqlalchemy import ColumnElement, func, select, true

from app.catalog.models import Product, ProductCategory


def tracks_stock(product: Product) -> bool:
    """Lo que diga el producto; si no dice nada, su categoría; y sin
    categoría, se controla (que es lo prudente)."""
    if product.tracks_stock is not None:
        return product.tracks_stock
    if product.category is not None:
        return product.category.tracks_stock
    return True


def tracks_stock_column() -> ColumnElement[bool]:
    """Lo mismo, pero para filtrar en una consulta — misma prioridad, un
    solo sitio donde se decide.

    Hace falta allí donde se avisa de existencias sin cargar los productos
    en memoria: un producto que no se agota está siempre «por debajo del
    mínimo» y no hay forma de reponerlo, así que sin este filtro el aviso
    se queda clavado para siempre y acaba enseñando a ignorar los avisos.

    Va como subconsulta correlacionada y no como `join` para que quien la
    use no tenga que tocar su `FROM`: se añade a un `where` y ya está."""
    category_tracks = (
        select(ProductCategory.tracks_stock)
        .where(ProductCategory.id == Product.category_id)
        .scalar_subquery()
    )
    return func.coalesce(Product.tracks_stock, category_tracks, true())
