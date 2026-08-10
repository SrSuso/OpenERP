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


def _render(sale: Sale, template: TicketTemplate, *, prices_include_tax: bool = False) -> str:
    return render_ticket(sale, template, prices_include_tax=prices_include_tax)


def _template(**overrides: object) -> TicketTemplate:
    defaults: dict[str, object] = {
        "id": 1,
        "name": "Estándar",
        "version": 1,
        "width_mm": 58,
        "header_text": "Mi Tienda\nCIF B00000000",
        "footer_text": "Gracias por su compra",
        "show_tax_breakdown": True,
        "show_line_discounts": False,
    }
    defaults.update(overrides)
    return TicketTemplate(**defaults)


def test_renders_header_and_footer_centred() -> None:
    sale = _sale([_line("Leche", "1", "1.20")], [Payment(method="CASH", amount=Decimal("1.20"))])

    text = _render(sale, _template())

    assert "Mi Tienda" in text
    assert "CIF B00000000" in text
    assert "Gracias por su compra" in text


def test_renders_sale_id_and_date() -> None:
    sale = _sale([_line("Leche", "1", "1.20")], [Payment(method="CASH", amount=Decimal("1.20"))])

    text = _render(sale, _template())

    assert "Venta #42" in text
    assert "2026-08-08 10:31" in text


def test_renders_each_line_with_name_and_total() -> None:
    sale = _sale(
        [_line("Leche entera 1L", "2", "1.20", tax="10")],
        [Payment(method="CASH", amount=Decimal("2.64"))],
    )

    text = _render(sale, _template())

    assert "Leche entera 1L" in text
    assert "2 x 1.20" in text
    assert "2.64" in text  # line total: 2 * 1.20 * 1.10


def test_tax_breakdown_present_when_enabled() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="21")],
        [Payment(method="CASH", amount=Decimal("12.10"))],
    )

    text = _render(sale, _template(show_tax_breakdown=True))

    assert "Base imponible" in text
    assert "IVA 21%" in text
    assert "10.00" in text
    assert "2.10" in text
    assert "TOTAL" in text
    assert "12.10" in text


def test_tax_breakdown_absent_when_disabled() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="21")],
        [Payment(method="CASH", amount=Decimal("12.10"))],
    )

    text = _render(sale, _template(show_tax_breakdown=False))

    assert "Base imponible" not in text
    assert "IVA 21%" not in text
    assert "TOTAL" in text


def test_tax_breakdown_has_one_line_per_distinct_rate() -> None:
    sale = _sale(
        [
            _line("Leche", "1", "10.00", tax="21"),
            _line("Pan", "1", "10.00", tax="10"),
        ],
        [Payment(method="CASH", amount=Decimal("23.10"))],
    )

    text = _render(sale, _template(show_tax_breakdown=True))

    assert "IVA 21%" in text
    assert "2.10" in text
    assert "IVA 10%" in text
    assert "1.00" in text


def test_tax_exempt_lines_get_no_rate_line() -> None:
    sale = _sale(
        [_line("Producto exento", "1", "10.00", tax="0")],
        [Payment(method="CASH", amount=Decimal("10.00"))],
    )

    text = _render(sale, _template(show_tax_breakdown=True))

    assert "Base imponible" in text
    assert "IVA 0%" not in text
    assert "IVA" not in text


def test_line_discount_shown_when_enabled_and_present() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0", discount="10")],
        [Payment(method="CASH", amount=Decimal("9.00"))],
    )

    text = _render(sale, _template(show_line_discounts=True))

    assert "Dto. 10%" in text
    assert "-1.00" in text


def test_line_discount_hidden_when_disabled() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0", discount="10")],
        [Payment(method="CASH", amount=Decimal("9.00"))],
    )

    text = _render(sale, _template(show_line_discounts=False))

    assert "Dto." not in text


def test_line_discount_omitted_for_lines_without_one() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0", discount="0")],
        [Payment(method="CASH", amount=Decimal("10.00"))],
    )

    text = _render(sale, _template(show_line_discounts=True))

    assert "Dto." not in text


def test_change_shown_only_on_cash_overpayment() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0")], [Payment(method="CASH", amount=Decimal("20.00"))]
    )

    text = _render(sale, _template())

    assert "Cambio" in text
    assert "10.00" in text


def test_no_change_line_for_an_exact_payment() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0")], [Payment(method="CASH", amount=Decimal("10.00"))]
    )

    text = _render(sale, _template())

    assert "Cambio" not in text


def test_payment_methods_are_translated() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0")], [Payment(method="CARD", amount=Decimal("10.00"))]
    )

    text = _render(sale, _template())

    assert "Tarjeta" in text


def test_no_lines_fit_within_the_declared_width() -> None:
    sale = _sale(
        [_line("Un producto con un nombre extremadamente largo de verdad", "1", "10.00")],
        [Payment(method="CASH", amount=Decimal("10.00"))],
    )

    text = _render(sale, _template(width_mm=58))

    width = CHARS_PER_WIDTH[58]
    for line in text.splitlines():
        assert len(line) <= width


def test_80mm_template_uses_the_wider_column_count() -> None:
    sale = _sale([_line("Leche", "1", "10.00")], [Payment(method="CASH", amount=Decimal("10.00"))])

    text = _render(sale, _template(width_mm=80))

    assert len(text.splitlines()[0]) <= CHARS_PER_WIDTH[80]


def test_prices_include_tax_extracts_it_instead_of_adding_it() -> None:
    # unit_price 12.10 already includes 21% IVA: net = 12.10 / 1.21 = 10.00,
    # tax = 2.10 — same TOTAL as the exclusive case, but IVA comes *out of*
    # the price shown per line instead of being added on top of it.
    sale = _sale(
        [_line("Leche", "1", "12.10", tax="21")],
        [Payment(method="CASH", amount=Decimal("12.10"))],
    )

    text = _render(sale, _template(show_tax_breakdown=True), prices_include_tax=True)

    assert "Base imponible" in text
    assert "10.00" in text
    assert "IVA 21%" in text
    assert "2.10" in text
    assert "TOTAL" in text
    assert "12.10" in text
    assert "Precios con IVA incluido" in text


def test_prices_include_tax_note_absent_when_disabled() -> None:
    sale = _sale([_line("Leche", "1", "10.00")], [Payment(method="CASH", amount=Decimal("10.00"))])

    text = _render(sale, _template(), prices_include_tax=False)

    assert "Precios con IVA incluido" not in text


def test_quantity_of_a_whole_number_does_not_use_scientific_notation() -> None:
    sale = _sale(
        [_line("Producto a granel", "100", "0.10")],
        [Payment(method="CASH", amount=Decimal("10.00"))],
    )

    text = _render(sale, _template())

    assert "100 x 0.10" in text
    assert "E+" not in text
