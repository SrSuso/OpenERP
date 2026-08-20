"""Product catalog endpoints.

Reading (list/get/barcode lookup) needs ``product.read`` — the POS will
hold that permission too. Everything that changes the catalog needs
``product.manage``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.auth.dependencies import CurrentUser, SessionDep
from app.catalog import images, service
from app.catalog.models import PosCategory, Unit
from app.catalog.presenters import category_to_read as _category_to_read
from app.catalog.presenters import product_to_read as _to_read
from app.catalog.schemas import (
    BarcodeCreate,
    BarcodeUpdate,
    ImageRead,
    ImageUpload,
    PackageCreate,
    PosCategoryCreate,
    PosCategoryRead,
    PosCategoryUpdate,
    ProductCategoryCreate,
    ProductCategoryRead,
    ProductCategoryUpdate,
    ProductCreate,
    ProductRead,
    ProductUpdate,
    UnitCreate,
    UnitMoveRequest,
    UnitRead,
    UnitUpdate,
)
from app.catalog.version import catalog_version
from app.rbac.dependencies import check_permission, require_permission
from app.rbac.permissions import POS_CATEGORY_MANAGE, PRICING_MANAGE, PRODUCT_MANAGE, PRODUCT_READ

router = APIRouter(tags=["catalog"])

_require_read = Depends(require_permission(PRODUCT_READ))
_require_manage = Depends(require_permission(PRODUCT_MANAGE))
_require_pos_category_manage = Depends(require_permission(POS_CATEGORY_MANAGE))


@router.get("/catalog-version", response_model=dict[str, str], dependencies=[_require_read])
async def get_catalog_version(session: SessionDep) -> dict[str, str]:
    """Para que la caja, que está en otro equipo y nadie recarga, sepa si
    ha cambiado algo sin traerse el catálogo entero cada vez. Ver
    `app.catalog.version`.

    Pide `product.read`, el mismo permiso que listar productos: quien está
    en la caja ya lo tiene (es lo que le deja mirar el catálogo), y a quien
    no puede ver productos no le sirve de nada saber que han cambiado."""
    return {"version": await catalog_version(session)}


def _pos_category_to_read(category: PosCategory) -> PosCategoryRead:
    return PosCategoryRead(
        id=category.id,
        name=category.name,
        color=category.color,
        display_order=category.display_order,
        is_active=category.is_active,
    )


@router.get(
    "/product-categories", response_model=list[ProductCategoryRead], dependencies=[_require_read]
)
async def list_categories(session: SessionDep) -> list[ProductCategoryRead]:
    return [_category_to_read(c) for c in await service.list_categories(session)]


@router.post(
    "/product-categories",
    response_model=ProductCategoryRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_category(
    payload: ProductCategoryCreate, session: SessionDep, user: CurrentUser
) -> ProductCategoryRead:
    # Crear una categoría sigue pidiendo ``product.manage``. Si se envían
    # valores de precios o impuestos, conservar el mismo límite de permiso
    # que PATCH /product-categories/{id}/pricing; ocultar el campo en React
    # nunca puede ser la barrera de seguridad.
    has_pricing_values = (
        payload.margin_rate is not None
        or payload.margin_amount is not None
        or bool(payload.price_formula)
        or bool(payload.tax_ids)
    )
    if has_pricing_values:
        check_permission(user, PRICING_MANAGE)

    category = await service.create_category(session, payload)
    if has_pricing_values:
        # Pricing owns formula/tax validation, recomputation and its audit.
        # The import is local because pricing already depends on catalog.
        from app.pricing import service as pricing_service
        from app.pricing.schemas import CategoryPricingUpdate

        category = await pricing_service.update_category_pricing(
            session,
            category.id,
            CategoryPricingUpdate(
                margin_rate=payload.margin_rate,
                margin_amount=payload.margin_amount,
                price_formula=payload.price_formula,
                tax_ids=payload.tax_ids,
            ),
        )
    return _category_to_read(category)


@router.patch(
    "/product-categories/{category_id}",
    response_model=ProductCategoryRead,
    dependencies=[_require_manage],
)
async def update_category(
    category_id: int, payload: ProductCategoryUpdate, session: SessionDep
) -> ProductCategoryRead:
    return _category_to_read(await service.update_category(session, category_id, payload))


@router.post(
    "/product-categories/{category_id}/deactivate",
    response_model=ProductCategoryRead,
    dependencies=[_require_manage],
)
async def deactivate_category(category_id: int, session: SessionDep) -> ProductCategoryRead:
    return _category_to_read(
        await service.set_category_active(session, category_id, is_active=False)
    )


@router.post(
    "/product-categories/{category_id}/activate",
    response_model=ProductCategoryRead,
    dependencies=[_require_manage],
)
async def activate_category(category_id: int, session: SessionDep) -> ProductCategoryRead:
    return _category_to_read(
        await service.set_category_active(session, category_id, is_active=True)
    )


@router.delete("/product-categories/{category_id}", status_code=204, dependencies=[_require_manage])
async def delete_category(category_id: int, session: SessionDep) -> None:
    await service.delete_category(session, category_id)


# --- fotos de productos y categorías ---------------------------------------
#
# Verlas sólo pide `product.read` (el TPV lo tiene); ponerlas o quitarlas,
# el permiso que dice `IMAGE_OWNERS` para ese tipo de dueño, comprobado
# dentro del endpoint porque depende de la URL. La ruta de lectura no lleva
# `response_model`: devuelve los bytes de la imagen, no JSON.


@router.get("/images/{entity_type}", dependencies=[_require_read])
async def list_image_versions(entity_type: str, session: SessionDep) -> dict[int, int]:
    """Qué productos (o categorías) tienen foto, y por qué versión van, para
    pintar `<img>` sólo donde hay algo y no provocar un 404 por cada uno."""
    return await images.list_versions(session, entity_type)


@router.get("/images/{entity_type}/{entity_id}", dependencies=[_require_read])
async def get_image(entity_type: str, entity_id: int, session: SessionDep) -> Response:
    image = await images.get(session, entity_type, entity_id)
    return Response(
        content=image.data,
        media_type=image.content_type,
        headers={
            # La URL lleva `?v=` con la versión, así que una foto concreta
            # no cambia nunca: se puede guardar mucho tiempo.
            "Cache-Control": "private, max-age=31536000, immutable",
            "ETag": f'"{entity_type}-{entity_id}-{image.version}"',
        },
    )


@router.put("/images/{entity_type}/{entity_id}", response_model=ImageRead)
async def put_image(
    entity_type: str,
    entity_id: int,
    payload: ImageUpload,
    session: SessionDep,
    user: CurrentUser,
) -> ImageRead:
    owner = images.owner_or_404(entity_type)
    check_permission(user, owner.manage_permission)
    image = await images.put(session, entity_type, entity_id, payload.data_url)
    return ImageRead(entity_id=image.entity_id, version=image.version)


@router.delete("/images/{entity_type}/{entity_id}", status_code=204)
async def delete_image(
    entity_type: str, entity_id: int, session: SessionDep, user: CurrentUser
) -> None:
    owner = images.owner_or_404(entity_type)
    check_permission(user, owner.manage_permission)
    await images.delete(session, entity_type, entity_id)


def _unit_to_read(unit: Unit) -> UnitRead:
    return UnitRead(id=unit.id, name=unit.name, display_order=unit.display_order)


@router.get("/units", response_model=list[UnitRead], dependencies=[_require_read])
async def list_units(session: SessionDep) -> list[UnitRead]:
    return [_unit_to_read(u) for u in await service.list_units(session)]


@router.post("/units", response_model=UnitRead, status_code=201, dependencies=[_require_manage])
async def create_unit(payload: UnitCreate, session: SessionDep) -> UnitRead:
    return _unit_to_read(await service.create_unit(session, payload))


@router.patch("/units/{unit_id}", response_model=UnitRead, dependencies=[_require_manage])
async def update_unit(unit_id: int, payload: UnitUpdate, session: SessionDep) -> UnitRead:
    return _unit_to_read(await service.update_unit(session, unit_id, payload))


@router.delete("/units/{unit_id}", status_code=204, dependencies=[_require_manage])
async def delete_unit(unit_id: int, session: SessionDep) -> None:
    await service.delete_unit(session, unit_id)


@router.post("/units/{unit_id}/move", response_model=list[UnitRead], dependencies=[_require_manage])
async def move_unit(unit_id: int, payload: UnitMoveRequest, session: SessionDep) -> list[UnitRead]:
    units = await service.move_unit(session, unit_id, payload.direction)
    return [_unit_to_read(u) for u in units]


@router.get("/products", response_model=list[ProductRead], dependencies=[_require_read])
async def list_products(
    session: SessionDep,
    category_id: Annotated[int | None, Query()] = None,
    pos_category_id: Annotated[int | None, Query()] = None,
    active_only: Annotated[bool, Query()] = True,
    search: Annotated[str | None, Query()] = None,
) -> list[ProductRead]:
    products = await service.list_products(
        session,
        category_id=category_id,
        pos_category_id=pos_category_id,
        active_only=active_only,
        search=search,
    )
    return [_to_read(p) for p in products]


@router.get("/pos-categories", response_model=list[PosCategoryRead], dependencies=[_require_read])
async def list_pos_categories(
    session: SessionDep,
    active_only: Annotated[bool, Query()] = True,
) -> list[PosCategoryRead]:
    categories = await service.list_pos_categories(session, active_only=active_only)
    return [_pos_category_to_read(c) for c in categories]


@router.post(
    "/pos-categories",
    response_model=PosCategoryRead,
    status_code=201,
    dependencies=[_require_pos_category_manage],
)
async def create_pos_category(payload: PosCategoryCreate, session: SessionDep) -> PosCategoryRead:
    return _pos_category_to_read(await service.create_pos_category(session, payload))


@router.patch(
    "/pos-categories/{pos_category_id}",
    response_model=PosCategoryRead,
    dependencies=[_require_pos_category_manage],
)
async def update_pos_category(
    pos_category_id: int, payload: PosCategoryUpdate, session: SessionDep
) -> PosCategoryRead:
    return _pos_category_to_read(
        await service.update_pos_category(session, pos_category_id, payload)
    )


@router.post(
    "/pos-categories/{pos_category_id}/deactivate",
    response_model=PosCategoryRead,
    dependencies=[_require_pos_category_manage],
)
async def deactivate_pos_category(pos_category_id: int, session: SessionDep) -> PosCategoryRead:
    return _pos_category_to_read(
        await service.set_pos_category_active(session, pos_category_id, is_active=False)
    )


@router.post(
    "/pos-categories/{pos_category_id}/activate",
    response_model=PosCategoryRead,
    dependencies=[_require_pos_category_manage],
)
async def activate_pos_category(pos_category_id: int, session: SessionDep) -> PosCategoryRead:
    return _pos_category_to_read(
        await service.set_pos_category_active(session, pos_category_id, is_active=True)
    )


@router.delete(
    "/pos-categories/{pos_category_id}",
    status_code=204,
    dependencies=[_require_pos_category_manage],
)
async def delete_pos_category(pos_category_id: int, session: SessionDep) -> None:
    await service.delete_pos_category(session, pos_category_id)


@router.get("/products/barcode/{barcode}", response_model=ProductRead, dependencies=[_require_read])
async def get_product_by_barcode(barcode: str, session: SessionDep) -> ProductRead:
    product, _package = await service.get_product_by_barcode(session, barcode)
    return _to_read(product)


@router.get("/products/{product_id}", response_model=ProductRead, dependencies=[_require_read])
async def get_product(product_id: int, session: SessionDep) -> ProductRead:
    return _to_read(await service.get_product(session, product_id))


@router.post(
    "/products", response_model=ProductRead, status_code=201, dependencies=[_require_manage]
)
async def create_product(payload: ProductCreate, session: SessionDep) -> ProductRead:
    return _to_read(await service.create_product(session, payload))


@router.patch("/products/{product_id}", response_model=ProductRead, dependencies=[_require_manage])
async def update_product(
    product_id: int, payload: ProductUpdate, session: SessionDep
) -> ProductRead:
    return _to_read(await service.update_product(session, product_id, payload))


@router.delete("/products/{product_id}", status_code=204, dependencies=[_require_manage])
async def delete_product(product_id: int, session: SessionDep) -> None:
    await service.delete_product(session, product_id)


@router.post(
    "/products/{product_id}/deactivate", response_model=ProductRead, dependencies=[_require_manage]
)
async def deactivate_product(product_id: int, session: SessionDep) -> ProductRead:
    return _to_read(await service.deactivate_product(session, product_id))


@router.post(
    "/products/{product_id}/activate", response_model=ProductRead, dependencies=[_require_manage]
)
async def activate_product(product_id: int, session: SessionDep) -> ProductRead:
    return _to_read(await service.activate_product(session, product_id))


@router.post(
    "/products/{product_id}/packages", response_model=ProductRead, dependencies=[_require_manage]
)
async def add_package(product_id: int, payload: PackageCreate, session: SessionDep) -> ProductRead:
    return _to_read(await service.add_package(session, product_id, payload))


@router.post(
    "/products/{product_id}/packages/{package_id}/barcodes",
    response_model=ProductRead,
    dependencies=[_require_manage],
)
async def add_barcode(
    product_id: int, package_id: int, payload: BarcodeCreate, session: SessionDep
) -> ProductRead:
    return _to_read(await service.add_barcode(session, product_id, package_id, payload))


@router.patch(
    "/products/{product_id}/packages/{package_id}/barcodes/{barcode_id}",
    response_model=ProductRead,
    dependencies=[_require_manage],
)
async def update_barcode(
    product_id: int,
    package_id: int,
    barcode_id: int,
    payload: BarcodeUpdate,
    session: SessionDep,
) -> ProductRead:
    return _to_read(
        await service.update_barcode(session, product_id, package_id, barcode_id, payload)
    )


@router.delete(
    "/products/{product_id}/packages/{package_id}/barcodes/{barcode_id}",
    response_model=ProductRead,
    dependencies=[_require_manage],
)
async def delete_barcode(
    product_id: int, package_id: int, barcode_id: int, session: SessionDep
) -> ProductRead:
    return _to_read(await service.delete_barcode(session, product_id, package_id, barcode_id))
