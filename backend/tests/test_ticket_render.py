"""Pure unit tests for app.tickets.render — no database needed."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from app.catalog.models import Product
from app.sales.models import Payment, Sale, SaleLine, SaleStatus
from app.tickets.models import TicketTemplate
from app.tickets.render import CHARS_PER_WIDTH, render_ticket


def _line(name: str, qty: str, price: str, tax: str = "0", discount: str = "0") -> SaleLine:
    line = SaleLine(
        product_id=1,
        package_id=1,
        package_name="UNIDAD",
        package_factor=Decimal(1),
        quantity_packages=Decimal(qty),
        quantity_base=Decimal(qty),
        unit_price=Decimal(price),
        tax_rate=Decimal(tax),
        discount_rate=Decimal(discount),
    )
    line.product = Product(sku="SKU", name=name, base_unit_name="UNIDAD")
    return line


def _sale(lines: list[SaleLine], payments: list[Payment]) -> Sale:
    sale = Sale(id=42, warehouse_id=1, location_id=1, status=SaleStatus.COMPLETED)
    sale.created_at = datetime(2026, 8, 8, 10, 30)
    sale.completed_at = datetime(2026, 8, 8, 10, 31)
    sale.lines = lines
    sale.payments = payments
    return sale


def _template(**overrides: object) -> TicketTemplate:
    defaults: dict[str, object] = {
        "id": 1,
        "name": "Estándar",
        "version": 1,
        "width_mm": 58,
        "header_text": "Mi Tienda\nCIF B00000000",
        "footer_text": "Gracias por su compra",
        "show_tax_breakdown": True,
    }
    defaults.update(overrides)
    return TicketTemplate(**defaults)


def test_renders_header_and_footer_centred() -> None:
    sale = _sale([_line("Leche", "1", "1.20")], [Payment(method="CASH", amount=Decimal("1.20"))])

    text = render_ticket(sale, _template())

    assert "Mi Tienda" in text
    assert "CIF B00000000" in text
    assert "Gracias por su compra" in text


def test_renders_sale_id_and_date() -> None:
    sale = _sale([_line("Leche", "1", "1.20")], [Payment(method="CASH", amount=Decimal("1.20"))])

    text = render_ticket(sale, _template())

    assert "Venta #42" in text
    assert "2026-08-08 10:31" in text


def test_renders_each_line_with_name_and_total() -> None:
    sale = _sale(
        [_line("Leche entera 1L", "2", "1.20", tax="10")],
        [Payment(method="CASH", amount=Decimal("2.64"))],
    )

    text = render_ticket(sale, _template())

    assert "Leche entera 1L" in text
    assert "2 x 1.20" in text
    assert "2.64" in text  # line total: 2 * 1.20 * 1.10


def test_tax_breakdown_present_when_enabled() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="21")],
        [Payment(method="CASH", amount=Decimal("12.10"))],
    )

    text = render_ticket(sale, _template(show_tax_breakdown=True))

    assert "Base imponible" in text
    assert "Impuestos" in text
    assert "10.00" in text
    assert "2.10" in text
    assert "TOTAL" in text
    assert "12.10" in text


def test_tax_breakdown_absent_when_disabled() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="21")],
        [Payment(method="CASH", amount=Decimal("12.10"))],
    )

    text = render_ticket(sale, _template(show_tax_breakdown=False))

    assert "Base imponible" not in text
    assert "Impuestos" not in text
    assert "TOTAL" in text


def test_change_shown_only_on_cash_overpayment() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0")], [Payment(method="CASH", amount=Decimal("20.00"))]
    )

    text = render_ticket(sale, _template())

    assert "Cambio" in text
    assert "10.00" in text


def test_no_change_line_for_an_exact_payment() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0")], [Payment(method="CASH", amount=Decimal("10.00"))]
    )

    text = render_ticket(sale, _template())

    assert "Cambio" not in text


def test_payment_methods_are_translated() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0")], [Payment(method="CARD", amount=Decimal("10.00"))]
    )

    text = render_ticket(sale, _template())

    assert "Tarjeta" in text


def test_no_lines_fit_within_the_declared_width() -> None:
    sale = _sale(
        [_line("Un producto con un nombre extremadamente largo de verdad", "1", "10.00")],
        [Payment(method="CASH", amount=Decimal("10.00"))],
    )

    text = render_ticket(sale, _template(width_mm=58))

    width = CHARS_PER_WIDTH[58]
    for line in text.splitlines():
        assert len(line) <= width


def test_80mm_template_uses_the_wider_column_count() -> None:
    sale = _sale([_line("Leche", "1", "10.00")], [Payment(method="CASH", amount=Decimal("10.00"))])

    text = render_ticket(sale, _template(width_mm=80))

    assert len(text.splitlines()[0]) <= CHARS_PER_WIDTH[80]


def test_quantity_of_a_whole_number_does_not_use_scientific_notation() -> None:
    sale = _sale(
        [_line("Producto a granel", "100", "0.10")],
        [Payment(method="CASH", amount=Decimal("10.00"))],
    )

    text = render_ticket(sale, _template())

    assert "100 x 0.10" in text
    assert "E+" not in text
