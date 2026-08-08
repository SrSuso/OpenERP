"""Pricing endpoints.

Previewing a formula and reading history only need ``product.read``
(already granted to everyone who can see products, including the POS).
Every mutating endpoint needs ``pricing.manage``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep
from app.catalog.presenters import product_to_read as _to_read
from app.catalog.schemas import ProductRead
from app.pricing import service
from app.pricing.models import ProductPriceHistory
from app.pricing.schemas import (
    FormulaPreviewRequest,
    FormulaPreviewResponse,
    PriceHistoryEntryRead,
    SetFormulaRequest,
    SetManualPriceRequest,
    SetPricingInputsRequest,
)
from app.rbac.dependencies import require_permission
from app.rbac.permissions import PRICING_MANAGE, PRODUCT_READ

router = APIRouter(tags=["pricing"])

_require_read = Depends(require_permission(PRODUCT_READ))
_require_manage = Depends(require_permission(PRICING_MANAGE))


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
