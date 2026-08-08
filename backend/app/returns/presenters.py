"""ORM -> response-schema conversion for ``app.returns.router``."""

from __future__ import annotations

from decimal import Decimal

from app.returns.models import Return, ReturnLine
from app.returns.schemas import ReturnLineRead, ReturnRead


def return_line_to_read(line: ReturnLine) -> ReturnLineRead:
    return ReturnLineRead(
        id=line.id,
        sale_line_id=line.sale_line_id,
        product_id=line.product_id,
        product_sku=line.product.sku,
        product_name=line.product.name,
        package_id=line.package_id,
        package_name=line.package_name,
        quantity_packages=line.quantity_packages,
        quantity_base=line.quantity_base,
        is_economic=line.is_economic,
        is_physical=line.is_physical,
        refund_amount=line.refund_amount,
        lot_id=line.lot_id,
        lot_number=line.lot.lot_number if line.lot else None,
        stock_movement_id=line.stock_movement_id,
    )


def return_to_read(ret: Return) -> ReturnRead:
    lines = [return_line_to_read(line) for line in ret.lines]
    return ReturnRead(
        id=ret.id,
        sale_id=ret.sale_id,
        notes=ret.notes,
        processed_by_user_id=ret.processed_by_user_id,
        created_at=ret.created_at,
        lines=lines,
        total_refund=sum((line.refund_amount for line in lines), start=Decimal(0)),
    )
