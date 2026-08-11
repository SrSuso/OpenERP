"""Las fotos de productos y categorías.

Quién puede tener foto es una lista cerrada (`IMAGE_OWNERS`), no lo que
venga en la URL: de ahí sale tanto la tabla contra la que se comprueba que
el dueño existe como el permiso que hace falta para cambiarla. Sin eso,
`/images/{lo_que_sea}/{id}` sería un cajón donde cualquiera con permiso de
producto podría escribir filas a nombre de otra cosa.

Los bytes llegan ya reescalados desde el navegador (ver
`frontend/src/features/images/resize.ts`); aquí sólo se comprueba que sean
una imagen de un formato conocido y que no pasen de `MAX_IMAGE_BYTES`, que
es la red de seguridad para quien llame a la API por su cuenta.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.catalog.models import EntityImage, PosCategory, Product, ProductCategory
from app.core.errors import NotFoundError, ValidationError
from app.db.base import Base
from app.rbac.permissions import POS_CATEGORY_MANAGE, PRODUCT_MANAGE

#: Una foto de tienda reescalada a 512 px ronda las 50 kB. El límite es
#: holgado a propósito: sólo tiene que frenar a quien suba el original de
#: la cámara saltándose el panel.
MAX_IMAGE_BYTES = 1_000_000

#: Formatos que un navegador enseña sin ayuda de nadie. `image/svg+xml`
#: queda fuera adrede: un SVG es un documento con scripts dentro, no una
#: foto.
ALLOWED_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp")


@dataclass(frozen=True)
class ImageOwner:
    model: type[Base]
    #: Permiso necesario para poner o quitar la foto. Verla sólo pide poder
    #: ver productos, que es lo que tiene el TPV.
    manage_permission: str
    label: str


IMAGE_OWNERS: dict[str, ImageOwner] = {
    "product": ImageOwner(Product, PRODUCT_MANAGE, "producto"),
    "product_category": ImageOwner(ProductCategory, PRODUCT_MANAGE, "categoría de producto"),
    "pos_category": ImageOwner(PosCategory, POS_CATEGORY_MANAGE, "categoría del TPV"),
}


def owner_or_404(entity_type: str) -> ImageOwner:
    owner = IMAGE_OWNERS.get(entity_type)
    if owner is None:
        raise NotFoundError(f"Unknown image owner {entity_type!r}.")
    return owner


def decode(data_url: str) -> tuple[str, bytes]:
    """`"data:image/jpeg;base64,..."` → tipo y bytes.

    Las fotos viajan como data URL dentro del JSON de siempre y no como
    `multipart/form-data` porque ya vienen reescaladas a unas decenas de kB:
    a ese tamaño, el 33% que engorda el base64 sale mucho más barato que
    montar (y proteger) una segunda forma de recibir peticiones.
    """
    prefix, _, payload = data_url.partition(",")
    if not payload or not prefix.startswith("data:") or not prefix.endswith(";base64"):
        raise ValidationError("La imagen tiene que venir como data URL en base64.")

    content_type = prefix.removeprefix("data:").removesuffix(";base64")
    if content_type not in ALLOWED_CONTENT_TYPES:
        allowed = ", ".join(t.removeprefix("image/").upper() for t in ALLOWED_CONTENT_TYPES)
        raise ValidationError(f"Formato de imagen no admitido. Usa {allowed}.")

    try:
        data = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise ValidationError("La imagen no se ha podido leer.") from None

    if not data:
        raise ValidationError("La imagen está vacía.")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValidationError(
            f"La imagen ocupa demasiado ({len(data) // 1024} kB); "
            f"el máximo son {MAX_IMAGE_BYTES // 1024} kB."
        )
    return content_type, data


async def _owner_exists(session: AsyncSession, owner: ImageOwner, entity_id: int) -> bool:
    model = owner.model
    found = await session.execute(select(model.id).where(model.id == entity_id))  # type: ignore[attr-defined]
    return found.scalar_one_or_none() is not None


async def get(session: AsyncSession, entity_type: str, entity_id: int) -> EntityImage:
    owner_or_404(entity_type)
    image = (
        await session.execute(
            select(EntityImage).where(
                EntityImage.entity_type == entity_type, EntityImage.entity_id == entity_id
            )
        )
    ).scalar_one_or_none()
    if image is None:
        raise NotFoundError(f"No image for {entity_type} {entity_id}.")
    return image


async def list_versions(session: AsyncSession, entity_type: str) -> dict[int, int]:
    """Qué dueños de este tipo tienen foto, y por qué versión van. El panel
    y el TPV lo piden una vez y así sólo pintan `<img>` donde hay algo que
    enseñar, en vez de provocar un 404 por cada producto sin foto."""
    owner_or_404(entity_type)
    rows = await session.execute(
        select(EntityImage.entity_id, EntityImage.version).where(
            EntityImage.entity_type == entity_type
        )
    )
    return {row[0]: row[1] for row in rows}


async def put(
    session: AsyncSession, entity_type: str, entity_id: int, data_url: str
) -> EntityImage:
    owner = owner_or_404(entity_type)
    if not await _owner_exists(session, owner, entity_id):
        raise NotFoundError(f"{owner.label.capitalize()} {entity_id} not found.")

    content_type, data = decode(data_url)
    existing = (
        await session.execute(
            select(EntityImage).where(
                EntityImage.entity_type == entity_type, EntityImage.entity_id == entity_id
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        image = EntityImage(
            entity_type=entity_type,
            entity_id=entity_id,
            content_type=content_type,
            data=data,
            version=1,
        )
        session.add(image)
    else:
        image = existing
        image.content_type = content_type
        image.data = data
        # Sube siempre: es lo que va en la URL para que el navegador se
        # entere de que la foto ya no es la misma.
        image.version += 1

    await session.flush()
    await audit.record(
        session,
        action="updated",
        entity_type=f"{entity_type}_image",
        entity_id=entity_id,
        after={"version": image.version, "bytes": len(data)},
    )
    return image


async def delete(session: AsyncSession, entity_type: str, entity_id: int) -> None:
    image = await get(session, entity_type, entity_id)
    await session.delete(image)
    await session.flush()
    await audit.record(
        session,
        action="deleted",
        entity_type=f"{entity_type}_image",
        entity_id=entity_id,
    )
