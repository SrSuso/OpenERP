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
from app.catalog.models import Product, ProductPackage
from app.catalog.schemas import (
    BarcodeCreate,
    PackageCreate,
    PackageRead,
    ProductCategoryCreate,
    ProductCategoryRead,
    ProductCreate,
    ProductRead,
    ProductUpdate,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import PRODUCT_MANAGE, PRODUCT_READ

router = APIRouter(tags=["catalog"])

_require_read = Depends(require_permission(PRODUCT_READ))
_require_manage = Depends(require_permission(PRODUCT_MANAGE))


def _package_to_read(package: ProductPackage) -> PackageRead:
    return PackageRead(
        id=package.id,
        name=package.name,
        factor=package.factor,
        is_base=package.is_base,
        barcodes=[b.barcode for b in package.barcodes],
    )


def _to_read(product: Product) -> ProductRead:
    return ProductRead(
        id=product.id,
        sku=product.sku,
        name=product.name,
        description=product.description,
        category_id=product.category_id,
        category_name=product.category.name if product.category else None,
        base_unit_name=product.base_unit_name,
        cost=product.cost,
        list_price=product.list_price,
        tax_rate=product.tax_rate,
        min_stock=product.min_stock,
        track_lots=product.track_lots,
        track_expiration=product.track_expiration,
        is_active=product.is_active,
        packages=[_package_to_read(p) for p in product.packages],
    )


@router.get(
    "/product-categories", response_model=list[ProductCategoryRead], dependencies=[_require_read]
)
async def list_categories(session: SessionDep) -> list[ProductCategoryRead]:
    categories = await service.list_categories(session)
    return [ProductCategoryRead(id=c.id, name=c.name, is_active=c.is_active) for c in categories]


@router.post(
    "/product-categories",
    response_model=ProductCategoryRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_category(
    payload: ProductCategoryCreate, session: SessionDep
) -> ProductCategoryRead:
    category = await service.create_category(session, payload)
    return ProductCategoryRead(id=category.id, name=category.name, is_active=category.is_active)


@router.get("/products", response_model=list[ProductRead], dependencies=[_require_read])
async def list_products(
    session: SessionDep,
    category_id: Annotated[int | None, Query()] = None,
    active_only: Annotated[bool, Query()] = True,
    search: Annotated[str | None, Query()] = None,
) -> list[ProductRead]:
    products = await service.list_products(
        session, category_id=category_id, active_only=active_only, search=search
    )
    return [_to_read(p) for p in products]


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
