"""ORM -> response-schema conversion for ``app.returns.router``."""

from __future__ import annotations

from decimal import Decimal

from app.returns.models import Refund, Return, ReturnLine
from app.returns.schemas import RefundRead, ReturnLineRead, ReturnRead


def return_line_to_read(line: ReturnLine) -> ReturnLineRead:
    return ReturnLineRead(
        id=line.id,
        sale_line_id=line.sale_line_id,
        product_id=line.product_id,
        product_sku=line.sale_line.product_sku,
        product_name=line.sale_line.product_name,
        package_id=line.package_id,
        package_name=line.package_name,
        refund_quantity_packages=line.refund_quantity_packages,
        refund_quantity_base=line.refund_quantity_base,
        stock_return_quantity_packages=line.stock_return_quantity_packages,
        stock_return_quantity_base=line.stock_return_quantity_base,
        refund_amount=line.refund_amount,
        lot_id=line.lot_id,
        lot_number=line.lot.lot_number if line.lot else None,
        stock_movement_id=line.stock_movement_id,
    )


def refund_to_read(refund: Refund) -> RefundRead:
    return RefundRead(
        id=refund.id,
        return_id=refund.return_id,
        amount=refund.amount,
        method=refund.method,
        status=refund.status,
        processed_by_user_id=refund.processed_by_user_id,
        created_at=refund.created_at,
        completed_at=refund.completed_at,
    )


def return_to_read(ret: Return) -> ReturnRead:
    lines = [return_line_to_read(line) for line in ret.lines]
    refund = refund_to_read(ret.refund) if ret.refund is not None else None
    return ReturnRead(
        id=ret.id,
        sale_id=ret.sale_id,
        notes=ret.notes,
        processed_by_user_id=ret.processed_by_user_id,
        created_at=ret.created_at,
        lines=lines,
        refund=refund,
        total_refund=refund.amount if refund is not None else Decimal(0),
    )
