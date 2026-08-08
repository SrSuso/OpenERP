"""ORM -> response-schema conversion for ``app.sales.router``."""

from __future__ import annotations

from decimal import Decimal

from app.sales import service
from app.sales.models import Payment, Sale, SaleLine
from app.sales.schemas import PaymentRead, SaleLineRead, SaleRead


def sale_line_to_read(line: SaleLine) -> SaleLineRead:
    totals = service.compute_line_totals(line)
    return SaleLineRead(
        id=line.id,
        product_id=line.product_id,
        product_sku=line.product.sku,
        product_name=line.product.name,
        package_id=line.package_id,
        package_name=line.package_name,
        package_factor=line.package_factor,
        quantity_packages=line.quantity_packages,
        quantity_base=line.quantity_base,
        unit_price=line.unit_price,
        tax_rate=line.tax_rate,
        discount_rate=line.discount_rate,
        subtotal=totals.subtotal,
        discount_amount=totals.discount_amount,
        tax_amount=totals.tax_amount,
        total=totals.total,
    )


def payment_to_read(payment: Payment) -> PaymentRead:
    return PaymentRead(
        id=payment.id, method=payment.method, amount=payment.amount, created_at=payment.created_at
    )


def sale_to_read(sale: Sale) -> SaleRead:
    lines = [sale_line_to_read(line) for line in sale.lines]
    total = sum((line.total for line in lines), start=Decimal(0))
    tendered = sum((p.amount for p in sale.payments), start=Decimal(0))
    return SaleRead(
        id=sale.id,
        warehouse_id=sale.warehouse_id,
        location_id=sale.location_id,
        status=sale.status,
        notes=sale.notes,
        cashier_user_id=sale.cashier_user_id,
        completed_at=sale.completed_at,
        created_at=sale.created_at,
        lines=lines,
        total=total,
        payments=[payment_to_read(p) for p in sale.payments],
        change_due=max(Decimal(0), tendered - total),
    )
