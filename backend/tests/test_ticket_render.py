"""Pure unit tests for app.tickets.render — no database needed."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.sales.models import Payment, Sale, SaleLine, SaleStatus
from app.tickets.models import (
    TicketFontWeight,
    TicketLayoutMode,
    TicketTaxDisplay,
    TicketTemplate,
)
from app.tickets.render import printable_characters, render_ticket


def _line(name: str, qty: str, price: str, tax: str = "0", discount: str = "0") -> SaleLine:
    line = SaleLine(
        product_id=1,
        product_sku="SKU",
        product_name=name,
        product_category_id=None,
        product_category_name=None,
        package_id=1,
        package_name="UNIDAD",
        package_factor=Decimal(1),
        quantity_packages=Decimal(qty),
        quantity_base=Decimal(qty),
        unit_price=Decimal(price),
        unit_cost=Decimal("0.50"),
        tracks_stock=True,
        track_lots=False,
        tax_rate=Decimal(tax),
        discount_rate=Decimal(discount),
        cold_drink_surcharge=Decimal(0),
    )
    return line


def _sale(lines: list[SaleLine], payments: list[Payment]) -> Sale:
    sale = Sale(id=42, warehouse_id=1, location_id=1, status=SaleStatus.COMPLETED)
    sale.created_at = datetime(2026, 8, 8, 10, 30, tzinfo=UTC)
    sale.completed_at = datetime(2026, 8, 8, 10, 31, tzinfo=UTC)
    sale.lines = lines
    sale.payments = payments
    return sale


def _render(
    sale: Sale,
    template: TicketTemplate,
    *,
    prices_include_tax: bool = False,
    cashier_name: str | None = None,
) -> str:
    return render_ticket(
        sale,
        template,
        prices_include_tax=prices_include_tax,
        business_timezone=ZoneInfo("Europe/Madrid"),
        cashier_name=cashier_name,
    )


def _template(**overrides: object) -> TicketTemplate:
    defaults: dict[str, object] = {
        "id": 1,
        "name": "Estándar",
        "version": 1,
        "printable_width_mm": 48,
        "margin_left_mm": 16,
        "margin_right_mm": 16,
        "font_size_px": 9,
        "font_weight": TicketFontWeight.NORMAL,
        "layout_mode": TicketLayoutMode.STANDARD,
        "layout_template": "",
        "header_text": "Mi Tienda\nCIF B00000000",
        "footer_text": "Gracias por su compra",
        "tax_display": TicketTaxDisplay.BREAKDOWN,
        "store_name": "",
        "store_tax_id": "",
        "store_address": "",
        "store_phone": "",
        "sale_number_prefix": "Venta #",
        "date_format": "%Y-%m-%d %H:%M",
        "show_unit_price": True,
        "show_cashier": False,
        "label_total": "TOTAL",
        "label_change": "Cambio",
        "label_cash": "Efectivo",
        "label_card": "Tarjeta",
        "label_other": "Otros",
        "label_discount": "Dto.",
        "tax_note": "IVA incluido",
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
    assert "2026-08-08 12:31" in text


def test_renders_each_line_with_name_and_total() -> None:
    sale = _sale(
        [_line("Leche entera 1L", "2", "1.20", tax="10")],
        [Payment(method="CASH", amount=Decimal("2.64"))],
    )

    text = _render(sale, _template())

    assert "Leche entera 1L" in text
    assert "2 x 1.20" in text
    assert "2.64" in text  # line total: 2 * 1.20 * 1.10


def test_custom_layout_uses_only_its_safe_variables_and_freezes_the_receipt_shape() -> None:
    sale = _sale(
        [_line("Leche entera", "2", "1.20", tax="10")],
        [Payment(method="CASH", amount=Decimal("2.64"))],
    )
    template = _template(
        store_name="MI TIENDA",
        layout_mode=TicketLayoutMode.CUSTOM,
        layout_template=(
            "{{ store.name | center }}\n{{ separator }}\n"
            "{% for line in sale.lines %}"
            "{{ line.name | left:24 }}{{ line.total | right:8 }}\n"
            "{% endfor %}"
            "{{ labels.total | left:24 }}{{ totals.total | right:8 }}\n"
            "{% for payment in sale.payments %}"
            "{{ payment.label | left:24 }}{{ payment.amount | right:8 }}\n"
            "{% endfor %}"
        ),
    )

    text = _render(sale, template)

    assert "MI TIENDA" in text
    assert "Leche entera" in text
    assert "TOTAL" in text
    assert "2.64" in text
    assert "Venta #42" not in text


def test_standard_editor_ignores_preserved_custom_source() -> None:
    sale = _sale([_line("Leche", "1", "1.20")], [Payment(method="CASH", amount=Decimal("1.20"))])
    template = _template(
        layout_mode=TicketLayoutMode.STANDARD,
        layout_template="ESTE DISEÑO ESTÁ GUARDADO PERO INACTIVO",
    )

    text = _render(sale, template)

    assert "Venta #42" in text
    assert "ESTE DISEÑO" not in text


def test_breakdown_prints_a_row_per_rate_with_base_and_quota() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="21")],
        [Payment(method="CASH", amount=Decimal("12.10"))],
    )

    text = _render(sale, _template(tax_display=TicketTaxDisplay.BREAKDOWN))

    assert "IVA incluido" in text
    assert "Tipo" in text
    assert "Base" in text
    assert "Cuota" in text
    # Una sola fila: 21%, base 10.00, cuota 2.10.
    row = next(line for line in text.splitlines() if line.startswith("21%"))
    assert "10.00" in row
    assert "2.10" in row
    assert "TOTAL" in text
    assert "12.10" in text


def test_tax_block_absent_entirely_under_none() -> None:
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="21")],
        [Payment(method="CASH", amount=Decimal("12.10"))],
    )

    text = _render(sale, _template(tax_display=TicketTaxDisplay.NONE))

    assert "IVA" not in text
    assert "Cuota" not in text
    assert "TOTAL" in text


def test_note_prints_the_legal_minimum_without_figures() -> None:
    """El mínimo de una factura simplificada: la expresión "IVA incluido",
    sin desglose (``TicketTaxDisplay.NOTE``)."""
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="21")],
        [Payment(method="CASH", amount=Decimal("12.10"))],
    )

    text = _render(sale, _template(tax_display=TicketTaxDisplay.NOTE))

    assert "IVA incluido" in text
    assert "Cuota" not in text
    assert "TOTAL" in text


def test_breakdown_has_one_row_per_distinct_rate() -> None:
    sale = _sale(
        [
            _line("Leche", "1", "10.00", tax="21"),
            _line("Pan", "1", "10.00", tax="10"),
        ],
        [Payment(method="CASH", amount=Decimal("23.10"))],
    )

    text = _render(sale, _template(tax_display=TicketTaxDisplay.BREAKDOWN))

    assert "2.10" in next(line for line in text.splitlines() if line.startswith("21%"))
    assert "1.00" in next(line for line in text.splitlines() if line.startswith("10%"))


def test_tax_exempt_lines_still_get_their_base_on_the_breakdown() -> None:
    """Una base exenta sí sale en el desglose, con cuota 0 — es lo que
    permite cuadrar el total contra la suma de bases."""
    sale = _sale(
        [_line("Producto exento", "1", "10.00", tax="0")],
        [Payment(method="CASH", amount=Decimal("10.00"))],
    )

    text = _render(sale, _template(tax_display=TicketTaxDisplay.BREAKDOWN))

    row = next(line for line in text.splitlines() if line.startswith("0%"))
    assert "10.00" in row
    assert "0.00" in row


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

    template = _template(printable_width_mm=48)
    text = _render(sale, template)

    width = printable_characters(template)
    for line in text.splitlines():
        assert len(line) <= width


def test_wider_printable_area_uses_the_wider_column_count() -> None:
    sale = _sale([_line("Leche", "1", "10.00")], [Payment(method="CASH", amount=Decimal("10.00"))])

    template = _template(printable_width_mm=72)
    text = _render(sale, template)

    assert len(text.splitlines()[0]) <= printable_characters(template)


def test_prices_include_tax_extracts_it_instead_of_adding_it() -> None:
    # unit_price 12.10 already includes 21% IVA: net = 12.10 / 1.21 = 10.00,
    # tax = 2.10 — same TOTAL as the exclusive case, but IVA comes *out of*
    # the price shown per line instead of being added on top of it.
    sale = _sale(
        [_line("Leche", "1", "12.10", tax="21")],
        [Payment(method="CASH", amount=Decimal("12.10"))],
    )

    text = _render(sale, _template(tax_display=TicketTaxDisplay.BREAKDOWN), prices_include_tax=True)

    row = next(line for line in text.splitlines() if line.startswith("21%"))
    assert "10.00" in row  # base extraída
    assert "2.10" in row  # cuota extraída
    assert "TOTAL" in text
    assert "12.10" in text  # el total cobrado no cambia


def test_the_breakdown_bases_add_up_to_the_total_with_several_rates() -> None:
    """Lo que hace cuadrable el ticket: sumar base + cuota de cada fila
    tiene que dar exactamente el TOTAL cobrado, con el IVA dentro del
    precio (recargo de equivalencia) y varios tipos en la misma venta."""
    sale = _sale(
        [
            _line("Leche", "1", "12.10", tax="21"),
            _line("Pan", "1", "5.50", tax="10"),
        ],
        [Payment(method="CASH", amount=Decimal("17.60"))],
    )

    text = _render(sale, _template(tax_display=TicketTaxDisplay.BREAKDOWN), prices_include_tax=True)

    assert "10.00" in next(line for line in text.splitlines() if line.startswith("21%"))
    assert "2.10" in next(line for line in text.splitlines() if line.startswith("21%"))
    assert "5.00" in next(line for line in text.splitlines() if line.startswith("10%"))
    assert "0.50" in next(line for line in text.splitlines() if line.startswith("10%"))
    # 10.00 + 2.10 + 5.00 + 0.50 = 17.60
    assert "17.60" in next(line for line in text.splitlines() if line.startswith("TOTAL"))


def test_quantity_of_a_whole_number_does_not_use_scientific_notation() -> None:
    sale = _sale(
        [_line("Producto a granel", "100", "0.10")],
        [Payment(method="CASH", amount=Decimal("10.00"))],
    )

    text = _render(sale, _template())

    assert "100 x 0.10" in text
    assert "E+" not in text


def test_the_templates_wording_and_date_format_reach_the_paper() -> None:
    """Todo lo que se cambia en la plantilla llega de verdad al papel — y
    la plantilla es el único sitio donde se cambia."""
    sale = _sale(
        [_line("Leche", "1", "10.00", tax="0")], [Payment(method="CASH", amount=Decimal("20.00"))]
    )

    text = _render(
        sale,
        _template(
            sale_number_prefix="Ticket nº ",
            date_format="%d/%m/%Y",
            label_total="A PAGAR",
            label_change="Su cambio",
            label_cash="Metálico",
        ),
    )

    assert "Ticket nº 42" in text
    assert "08/08/2026" in text
    assert "A PAGAR" in text
    assert "Su cambio" in text
    assert "Metálico" in text
    # Y lo que sustituyen ya no aparece.
    assert "Venta #" not in text
    assert "TOTAL" not in text
    assert "Efectivo" not in text


def test_store_details_print_above_the_template_header() -> None:
    sale = _sale([_line("Leche", "1", "1.00")], [Payment(method="CASH", amount=Decimal("1.00"))])

    text = _render(
        sale,
        _template(
            header_text="Gracias por su visita",
            store_name="ALIMENTACION PEPE",
            store_tax_id="12345678Z",
            store_address="C/ Mayor 3\n28001 Madrid",
            store_phone="911234567",
        ),
    )

    lines = [line.strip() for line in text.splitlines()]
    assert lines[0] == "ALIMENTACION PEPE"
    assert lines[1] == "12345678Z"
    assert lines[2] == "C/ Mayor 3"
    assert lines[3] == "28001 Madrid"
    assert lines[4] == "911234567"
    assert lines[5] == "Gracias por su visita"


def test_unit_price_line_can_be_turned_off() -> None:
    sale = _sale([_line("Leche", "2", "1.20")], [Payment(method="CASH", amount=Decimal("2.40"))])

    with_line = _render(sale, _template())
    without = _render(sale, _template(show_unit_price=False))

    assert "2 x 1.20" in with_line
    assert "2 x 1.20" not in without
    assert "Leche" in without  # el producto sigue, sólo se va el detalle


def test_cashier_shown_only_when_asked_for() -> None:
    sale = _sale([_line("Leche", "1", "1.00")], [Payment(method="CASH", amount=Decimal("1.00"))])

    off = _render(sale, _template(), cashier_name="Ana")
    on = _render(sale, _template(show_cashier=True), cashier_name="Ana")

    assert "Ana" not in off
    assert "Ana" in on
