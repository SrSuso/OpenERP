"""Pricing endpoints.

Previewing a formula and reading history only need ``product.read``
(already granted to everyone who can see products, including the POS).
Every mutating endpoint needs ``pricing.manage``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep
from app.catalog.presenters import category_to_read as _category_to_read
from app.catalog.presenters import product_to_read as _to_read
from app.catalog.schemas import ProductCategoryRead, ProductRead
from app.pricing import service
from app.pricing.models import ProductPriceHistory, Tax
from app.pricing.schemas import (
    CategoryPricingUpdate,
    FormulaPreviewRequest,
    FormulaPreviewResponse,
    PriceHistoryEntryRead,
    PricingSettingsRead,
    PricingSettingsUpdate,
    SetFormulaRequest,
    SetManualPriceRequest,
    SetPricingInputsRequest,
    TaxCreate,
    TaxRead,
    TaxUpdate,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import PRICING_MANAGE, PRODUCT_READ

router = APIRouter(tags=["pricing"])

_require_read = Depends(require_permission(PRODUCT_READ))
_require_manage = Depends(require_permission(PRICING_MANAGE))


def _tax_to_read(tax: Tax) -> TaxRead:
    return TaxRead(
        id=tax.id,
        name=tax.name,
        rate=tax.rate,
        surcharge_rate=tax.surcharge_rate,
        is_active=tax.is_active,
    )


def _history_to_read(entry: ProductPriceHistory) -> PriceHistoryEntryRead:
    return PriceHistoryEntryRead(
        id=entry.id,
        product_id=entry.product_id,
        cost=entry.cost,
        tax_rate=entry.tax_rate,
        surcharge_rate=entry.surcharge_rate,
        margin_rate=entry.margin_rate,
        price_formula=entry.price_formula,
        list_price=entry.list_price,
        created_at=entry.created_at,
    )


@router.post(
    "/pricing/preview", response_model=FormulaPreviewResponse, dependencies=[_require_read]
)
async def preview_formula(payload: FormulaPreviewRequest) -> FormulaPreviewResponse:
    return FormulaPreviewResponse(result=service.preview(payload))


@router.get(
    "/products/{product_id}/pricing/history",
    response_model=list[PriceHistoryEntryRead],
    dependencies=[_require_read],
)
async def get_price_history(product_id: int, session: SessionDep) -> list[PriceHistoryEntryRead]:
    entries = await service.list_price_history(session, product_id)
    return [_history_to_read(e) for e in entries]


@router.patch(
    "/products/{product_id}/pricing", response_model=ProductRead, dependencies=[_require_manage]
)
async def set_pricing_inputs(
    product_id: int, payload: SetPricingInputsRequest, session: SessionDep
) -> ProductRead:
    return _to_read(await service.set_pricing_inputs(session, product_id, payload))


@router.put(
    "/products/{product_id}/pricing/formula",
    response_model=ProductRead,
    dependencies=[_require_manage],
)
async def set_price_formula(
    product_id: int, payload: SetFormulaRequest, session: SessionDep
) -> ProductRead:
    return _to_read(await service.set_price_formula(session, product_id, payload.price_formula))


@router.delete(
    "/products/{product_id}/pricing/formula",
    response_model=ProductRead,
    dependencies=[_require_manage],
)
async def clear_price_formula(product_id: int, session: SessionDep) -> ProductRead:
    return _to_read(await service.clear_price_formula(session, product_id))


@router.put(
    "/products/{product_id}/pricing/manual-price",
    response_model=ProductRead,
    dependencies=[_require_manage],
)
async def set_manual_price(
    product_id: int, payload: SetManualPriceRequest, session: SessionDep
) -> ProductRead:
    return _to_read(await service.set_manual_price(session, product_id, payload.list_price))


# --- taxes (managed on their own — never a raw number typed on a product) ---


@router.get("/taxes", response_model=list[TaxRead], dependencies=[_require_read])
async def list_taxes(session: SessionDep) -> list[TaxRead]:
    return [_tax_to_read(t) for t in await service.list_taxes(session)]


@router.post("/taxes", response_model=TaxRead, status_code=201, dependencies=[_require_manage])
async def create_tax(payload: TaxCreate, session: SessionDep) -> TaxRead:
    return _tax_to_read(await service.create_tax(session, payload))


@router.patch("/taxes/{tax_id}", response_model=TaxRead, dependencies=[_require_manage])
async def update_tax(tax_id: int, payload: TaxUpdate, session: SessionDep) -> TaxRead:
    return _tax_to_read(await service.update_tax(session, tax_id, payload))


# --- category-level pricing defaults ----------------------------------------


@router.patch(
    "/product-categories/{category_id}/pricing",
    response_model=ProductCategoryRead,
    dependencies=[_require_manage],
)
async def set_category_pricing(
    category_id: int, payload: CategoryPricingUpdate, session: SessionDep
) -> ProductCategoryRead:
    return _category_to_read(await service.update_category_pricing(session, category_id, payload))


# --- store-wide pricing formula ("PVP calculado automáticamente") ----------


@router.get("/pricing/settings", response_model=PricingSettingsRead, dependencies=[_require_read])
async def get_pricing_settings(session: SessionDep) -> PricingSettingsRead:
    settings = await service.get_settings(session)
    return PricingSettingsRead(
        formula=settings.formula, prices_include_tax=settings.prices_include_tax
    )


@router.put("/pricing/settings", response_model=PricingSettingsRead, dependencies=[_require_manage])
async def set_pricing_settings(
    payload: PricingSettingsUpdate, session: SessionDep
) -> PricingSettingsRead:
    settings = await service.update_settings(session, payload)
    return PricingSettingsRead(
        formula=settings.formula, prices_include_tax=settings.prices_include_tax
    )
