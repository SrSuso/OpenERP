"""Product catalog endpoints.

Reading (list/get/barcode lookup) needs ``product.read`` — the POS will
hold that permission too. Everything that changes the catalog needs
``product.manage``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import SessionDep
from app.catalog import service
from app.catalog.models import PosCategory
from app.catalog.presenters import category_to_read as _category_to_read
from app.catalog.presenters import product_to_read as _to_read
from app.catalog.schemas import (
    BarcodeCreate,
    PackageCreate,
    PosCategoryCreate,
    PosCategoryRead,
    PosCategoryUpdate,
    ProductCategoryCreate,
    ProductCategoryRead,
    ProductCreate,
    ProductRead,
    ProductUpdate,
    UnitCreate,
    UnitRead,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import POS_CATEGORY_MANAGE, PRODUCT_MANAGE, PRODUCT_READ

router = APIRouter(tags=["catalog"])

_require_read = Depends(require_permission(PRODUCT_READ))
_require_manage = Depends(require_permission(PRODUCT_MANAGE))
_require_pos_category_manage = Depends(require_permission(POS_CATEGORY_MANAGE))


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
    payload: ProductCategoryCreate, session: SessionDep
) -> ProductCategoryRead:
    return _category_to_read(await service.create_category(session, payload))


@router.get("/units", response_model=list[UnitRead], dependencies=[_require_read])
async def list_units(session: SessionDep) -> list[UnitRead]:
    return [UnitRead(id=u.id, name=u.name) for u in await service.list_units(session)]


@router.post("/units", response_model=UnitRead, status_code=201, dependencies=[_require_manage])
async def create_unit(payload: UnitCreate, session: SessionDep) -> UnitRead:
    unit = await service.create_unit(session, payload)
    return UnitRead(id=unit.id, name=unit.name)


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
    return _pos_category_to_read(await service.deactivate_pos_category(session, pos_category_id))


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


@router.post(
    "/products/{product_id}/deactivate", response_model=ProductRead, dependencies=[_require_manage]
)
async def deactivate_product(product_id: int, session: SessionDep) -> ProductRead:
    return _to_read(await service.deactivate_product(session, product_id))


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
