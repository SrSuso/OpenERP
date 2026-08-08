"""Supplier endpoints. Reading needs ``supplier.read``, writing needs
``supplier.manage``."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep
from app.rbac.dependencies import require_permission
from app.rbac.permissions import SUPPLIER_MANAGE, SUPPLIER_READ
from app.suppliers import service
from app.suppliers.models import ProductSupplier, Supplier
from app.suppliers.schemas import (
    ProductSupplierRead,
    ProductSupplierUpsert,
    SupplierCreate,
    SupplierRead,
    SupplierUpdate,
)

router = APIRouter(tags=["suppliers"])

_require_read = Depends(require_permission(SUPPLIER_READ))
_require_manage = Depends(require_permission(SUPPLIER_MANAGE))


def _supplier_to_read(supplier: Supplier) -> SupplierRead:
    return SupplierRead(
        id=supplier.id,
        name=supplier.name,
        tax_id=supplier.tax_id,
        email=supplier.email,
        phone=supplier.phone,
        address=supplier.address,
        is_active=supplier.is_active,
    )


def _link_to_read(link: ProductSupplier) -> ProductSupplierRead:
    return ProductSupplierRead(
        id=link.id,
        product_id=link.product_id,
        product_sku=link.product.sku,
        product_name=link.product.name,
        supplier_id=link.supplier_id,
        supplier_name=link.supplier.name,
        supplier_sku=link.supplier_sku,
        supplier_cost=link.supplier_cost,
        is_preferred=link.is_preferred,
    )


@router.get("/suppliers", response_model=list[SupplierRead], dependencies=[_require_read])
async def list_suppliers(session: SessionDep, active_only: bool = True) -> list[SupplierRead]:
    suppliers = await service.list_suppliers(session, active_only=active_only)
    return [_supplier_to_read(s) for s in suppliers]


@router.post(
    "/suppliers", response_model=SupplierRead, status_code=201, dependencies=[_require_manage]
)
async def create_supplier(payload: SupplierCreate, session: SessionDep) -> SupplierRead:
    return _supplier_to_read(await service.create_supplier(session, payload))


@router.get("/suppliers/{supplier_id}", response_model=SupplierRead, dependencies=[_require_read])
async def get_supplier(supplier_id: int, session: SessionDep) -> SupplierRead:
    return _supplier_to_read(await service.get_supplier(session, supplier_id))


@router.patch(
    "/suppliers/{supplier_id}", response_model=SupplierRead, dependencies=[_require_manage]
)
async def update_supplier(
    supplier_id: int, payload: SupplierUpdate, session: SessionDep
) -> SupplierRead:
    return _supplier_to_read(await service.update_supplier(session, supplier_id, payload))


@router.post(
    "/suppliers/{supplier_id}/deactivate",
    response_model=SupplierRead,
    dependencies=[_require_manage],
)
async def deactivate_supplier(supplier_id: int, session: SessionDep) -> SupplierRead:
    return _supplier_to_read(await service.deactivate_supplier(session, supplier_id))


@router.get(
    "/suppliers/{supplier_id}/products",
    response_model=list[ProductSupplierRead],
    dependencies=[_require_read],
)
async def list_supplier_products(
    supplier_id: int, session: SessionDep
) -> list[ProductSupplierRead]:
    links = await service.list_supplier_products(session, supplier_id)
    return [_link_to_read(link) for link in links]


@router.get(
    "/products/{product_id}/suppliers",
    response_model=list[ProductSupplierRead],
    dependencies=[_require_read],
)
async def list_product_suppliers(product_id: int, session: SessionDep) -> list[ProductSupplierRead]:
    links = await service.list_product_suppliers(session, product_id)
    return [_link_to_read(link) for link in links]


@router.put(
    "/products/{product_id}/suppliers/{supplier_id}",
    response_model=ProductSupplierRead,
    dependencies=[_require_manage],
)
async def upsert_product_supplier(
    product_id: int, supplier_id: int, payload: ProductSupplierUpsert, session: SessionDep
) -> ProductSupplierRead:
    link = await service.upsert_product_supplier(session, product_id, supplier_id, payload)
    return _link_to_read(link)


@router.delete(
    "/products/{product_id}/suppliers/{supplier_id}",
    status_code=204,
    dependencies=[_require_manage],
)
async def remove_product_supplier(product_id: int, supplier_id: int, session: SessionDep) -> None:
    await service.remove_product_supplier(session, product_id, supplier_id)
