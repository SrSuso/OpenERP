"""Pure rendering: a ``Sale`` + a ``TicketTemplate`` in, a monospace
58mm/80mm receipt string out. No I/O, no database access — everything this
needs is already loaded on the ORM objects passed in, which is what keeps
it trivially unit-testable and keeps ``app.tickets.service`` the only place
that decides *when* a ticket gets generated (once, ever, per sale).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from app.core.business_time import to_business_time
from app.sales.models import Sale, SaleLine
from app.tickets.layout import render_layout_template
from app.tickets.models import TicketFontWeight, TicketLayoutMode, TicketTaxDisplay, TicketTemplate

#: Characters a standard monospace receipt font fits per line, for each
#: supported roll width — the two off only because thermal printers only
#: come in these two widths in practice.
_CSS_PIXELS_PER_INCH = Decimal(96)
_MM_PER_INCH = Decimal("25.4")
# Conservative advance shared by the supported monospace fonts. Courier New,
# Liberation Mono and DejaVu Sans Mono keep the same character advance in bold;
# 0.61 em leaves a small safety margin over their roughly 0.60 em real width
# without wasting a complete receipt column.
_CHARACTER_WIDTH_EM = {
    TicketFontWeight.NORMAL: Decimal("0.61"),
    TicketFontWeight.BOLD: Decimal("0.61"),
}


def printable_characters(template: TicketTemplate) -> int:
    """Return a safe line capacity for the selected physical print profile."""
    glyph_width_mm = (
        Decimal(template.font_size_px)
        * _CHARACTER_WIDTH_EM[TicketFontWeight(template.font_weight)]
        * _MM_PER_INCH
        / _CSS_PIXELS_PER_INCH
    )
    return max(16, int(Decimal(template.printable_width_mm) / glyph_width_mm))


_CENTS = Decimal("0.01")


def _money(value: Decimal) -> str:
    return f"{value.quantize(_CENTS, rounding=ROUND_HALF_UP):.2f} €"


def _quantity(value: Decimal) -> str:
    """Up to 3 decimals, trailing zeros trimmed — deliberately not
    ``Decimal.normalize()``, which can flip a whole number like ``100``
    into scientific notation (``1E+2``)."""
    text = f"{value.quantize(Decimal('0.001')):f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _rate_label(value: Decimal) -> str:
    """A tax/discount percentage, trailing zeros trimmed — "21" not
    "21.00", "10.5" kept as-is. Same trimming idea as ``_quantity``."""
    text = f"{value.quantize(Decimal('0.01')):f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _rule(width: int, char: str = "-") -> str:
    return char * width


def _center(text: str, width: int) -> str:
    text = text.strip()
    if len(text) >= width:
        return text[:width]
    pad = width - len(text)
    left = pad // 2
    return " " * left + text + " " * (pad - left)


def _two_column(left: str, right: str, width: int) -> list[str]:
    """``left`` on the left, ``right`` right-aligned — wraps ``left`` onto
    extra lines (right-padded, no amount) if it alone doesn't fit."""
    if len(left) + 1 + len(right) <= width:
        return [left + " " * (width - len(left) - len(right)) + right]

    lines: list[str] = []
    remaining = left
    while len(remaining) > width:
        lines.append(remaining[:width])
        remaining = remaining[width:]
    last_line_budget = width - len(right) - 1
    if len(remaining) <= last_line_budget:
        lines.append(remaining + " " * (width - len(remaining) - len(right)) + right)
    else:
        lines.append(remaining)
        lines.append(" " * (width - len(right)) + right)
    return lines


def _three_column(left: str, middle: str, right: str, width: int) -> str:
    """``left`` flush left, then ``middle`` and ``right`` right-aligned in
    the two columns that share whatever space is left — the tax breakdown
    table's "Tipo / Base / Cuota" rows."""
    remaining = width - len(left)
    middle_width = remaining // 2
    return left + middle.rjust(middle_width) + right.rjust(remaining - middle_width)


def _line_amounts(line: SaleLine, *, prices_include_tax: bool) -> tuple[Decimal, Decimal, Decimal]:
    """``(net, tax_amount, total)`` — same formula as
    ``app.sales.service.compute_amounts`` (duplicated rather than
    imported, same as ``app.returns.service``/``app.dashboards.metrics``:
    each module stays self-contained). ``prices_include_tax``
    (``app.pricing.models.PricingSettings``): ``False`` adds tax on top of
    ``unit_price``; ``True`` treats it as already tax-included and
    extracts the tax from it instead — ``total`` is what was actually
    charged either way."""
    product_subtotal = line.quantity_base * line.unit_price
    surcharge_total = line.quantity_base * line.cold_drink_surcharge
    discount_amount = product_subtotal * line.discount_rate / Decimal(100)
    remaining = product_subtotal - discount_amount + surcharge_total
    if prices_include_tax:
        net = remaining / (Decimal(1) + line.tax_rate / Decimal(100))
        tax_amount = remaining - net
        return net, tax_amount, remaining
    tax_amount = remaining * line.tax_rate / Decimal(100)
    return remaining, tax_amount, remaining + tax_amount


def _layout_context(
    sale: Sale,
    template: TicketTemplate,
    *,
    prices_include_tax: bool,
    business_timezone: ZoneInfo,
    cashier_name: str | None,
    width: int,
) -> dict[str, object]:
    """The complete, closed set of values available to a custom layout."""
    subtotal = Decimal(0)
    tax_total = Decimal(0)
    net_by_rate: dict[Decimal, Decimal] = {}
    tax_by_rate: dict[Decimal, Decimal] = {}
    lines: list[dict[str, str]] = []
    for line in sale.lines:
        net, tax_amount, total = _line_amounts(line, prices_include_tax=prices_include_tax)
        subtotal += net
        tax_total += tax_amount
        net_by_rate[line.tax_rate] = net_by_rate.get(line.tax_rate, Decimal(0)) + net
        tax_by_rate[line.tax_rate] = tax_by_rate.get(line.tax_rate, Decimal(0)) + tax_amount
        discount = line.quantity_base * line.unit_price * line.discount_rate / Decimal(100)
        lines.append(
            {
                "name": line.product_name,
                "quantity": _quantity(line.quantity_packages),
                "unit_price": _money(line.unit_price),
                "total": _money(total),
                "discount": _money(discount),
                "tax_rate": _rate_label(line.tax_rate),
            }
        )

    total = subtotal + tax_total
    tendered = sum((payment.amount for payment in sale.payments), start=Decimal(0))
    labels = {
        "CASH": template.label_cash,
        "CARD": template.label_card,
        "OTHER": template.label_other,
    }
    when = sale.completed_at or sale.created_at
    return {
        "separator": _rule(width),
        "store": {
            "name": template.store_name,
            "tax_id": template.store_tax_id,
            "address": template.store_address,
            "phone": template.store_phone,
        },
        "template": {"header": template.header_text, "footer": template.footer_text},
        "sale": {
            "number": str(sale.number or sale.id),
            "date": to_business_time(when, business_timezone).strftime(template.date_format),
            "cashier": cashier_name or "",
            "lines": lines,
            "payments": [
                {
                    "label": labels.get(payment.method, payment.method),
                    "amount": _money(payment.amount),
                }
                for payment in sale.payments
            ],
            "taxes": [
                {
                    "rate": _rate_label(rate),
                    "base": _money(net_by_rate[rate]),
                    "amount": _money(tax_by_rate[rate]),
                }
                for rate in sorted(net_by_rate)
            ],
        },
        "totals": {
            "subtotal": _money(subtotal),
            "tax": _money(tax_total),
            "total": _money(total),
            "tendered": _money(tendered),
            "change": _money(max(Decimal(0), tendered - total)),
        },
        "labels": {
            "total": template.label_total,
            "change": template.label_change,
            "cash": template.label_cash,
            "card": template.label_card,
            "other": template.label_other,
            "tax_note": template.tax_note,
        },
    }


def render_ticket(
    sale: Sale,
    template: TicketTemplate,
    *,
    prices_include_tax: bool,
    business_timezone: ZoneInfo,
    cashier_name: str | None = None,
) -> str:
    """Todo lo que decide cómo se ve el ticket sale de `template`, y de
    ningún otro sitio.

    Antes la mitad venía de Configuración: los datos de la tienda se
    imprimían desde allí *y* desde la cabecera de la plantilla, así que
    salían dos veces y no había forma de saber cuál mandaba. Ahora el
    ticket se edita en un único sitio, su plantilla, y de paso queda
    guardado en ella."""
    width = printable_characters(template)
    if template.layout_mode == TicketLayoutMode.CUSTOM and (template.layout_template or "").strip():
        return render_layout_template(
            template.layout_template or "",
            _layout_context(
                sale,
                template,
                prices_include_tax=prices_include_tax,
                business_timezone=business_timezone,
                cashier_name=cashier_name,
                width=width,
            ),
            width,
        )
    rows: list[str] = []

    # Los datos de la tienda van antes de la cabecera libre, que queda para
    # lo que no es un dato fijo (un saludo, un aviso de rebajas).
    store_lines = [
        *template.store_name.splitlines(),
        *template.store_tax_id.splitlines(),
        *template.store_address.splitlines(),
        *template.store_phone.splitlines(),
    ]
    for store_line in (line for line in store_lines if line.strip()):
        rows.append(_center(store_line, width))
    for header_line in (line for line in template.header_text.splitlines() if line.strip()):
        rows.append(_center(header_line, width))
    if rows:
        rows.append(_rule(width))

    # El número de venta, no el `id`: el `id` se reparte al abrir el
    # carrito y deja huecos por cada uno que no llega a cobrarse. Un ticket
    # sólo se imprime de una venta cobrada, así que aquí siempre lo hay.
    rows.append(f"{template.sale_number_prefix}{sale.number or sale.id}")
    when = sale.completed_at or sale.created_at
    rows.append(to_business_time(when, business_timezone).strftime(template.date_format))
    if template.show_cashier and cashier_name:
        rows.append(f"Le atendió: {cashier_name}")
    rows.append(_rule(width))

    subtotal = Decimal(0)
    #: One accumulator per distinct rate present on the sale, not a single
    #: combined figure — what makes the per-rate table possible under
    #: ``TicketTaxDisplay.BREAKDOWN``.
    net_by_rate: dict[Decimal, Decimal] = {}
    tax_by_rate: dict[Decimal, Decimal] = {}
    for line in sale.lines:
        net, tax_amount, total = _line_amounts(line, prices_include_tax=prices_include_tax)
        discount_amount = line.quantity_base * line.unit_price * line.discount_rate / Decimal(100)
        net_by_rate[line.tax_rate] = net_by_rate.get(line.tax_rate, Decimal(0)) + net
        tax_by_rate[line.tax_rate] = tax_by_rate.get(line.tax_rate, Decimal(0)) + tax_amount
        subtotal += net
        rows.extend(_two_column(line.product_name, _money(total), width))
        if line.cold_drink_surcharge > 0:
            surcharge_total = line.quantity_base * line.cold_drink_surcharge
            if not prices_include_tax:
                surcharge_total *= Decimal(1) + line.tax_rate / Decimal(100)
            rows.extend(
                _two_column(
                    f"Incluye {line.pos_surcharge_label or 'bebida fría'}",
                    f"+{_money(surcharge_total)}",
                    width,
                )
            )
        if template.show_unit_price:
            rows.append(f"{_quantity(line.quantity_packages)} x {_money(line.unit_price)}")
        if template.show_line_discounts and line.discount_rate > 0:
            rows.extend(
                _two_column(
                    f"{template.label_discount} {_rate_label(line.discount_rate)}%",
                    f"-{_money(discount_amount)}",
                    width,
                )
            )

    tax_total = sum(tax_by_rate.values(), start=Decimal(0))
    total = subtotal + tax_total
    tax_note = template.tax_note
    rows.append(_rule(width))
    rows.extend(_two_column(template.label_total, _money(total), width))

    # The tax block goes *after* the total, the way a Spanish factura
    # simplificada reads — see ``TicketTaxDisplay``.
    if template.tax_display == TicketTaxDisplay.NOTE:
        rows.append(_center(tax_note, width))
    elif template.tax_display == TicketTaxDisplay.BREAKDOWN:
        rows.append(_rule(width))
        rows.append(tax_note)
        rows.append(_three_column("Tipo", "Base", "Cuota", width))
        for rate in sorted(net_by_rate):
            rows.append(
                _three_column(
                    f"{_rate_label(rate)}%",
                    _money(net_by_rate[rate]),
                    _money(tax_by_rate[rate]),
                    width,
                )
            )
    rows.append(_rule(width))

    method_labels = {
        "CASH": template.label_cash,
        "CARD": template.label_card,
        "OTHER": template.label_other,
    }
    for payment in sale.payments:
        method = method_labels.get(payment.method, payment.method)
        rows.extend(_two_column(method, _money(payment.amount), width))
    tendered = sum((p.amount for p in sale.payments), start=Decimal(0))
    change = tendered - total
    if change > 0:
        rows.extend(_two_column(template.label_change, _money(change), width))

    if template.footer_text.strip():
        rows.append(_rule(width))
        for footer_line in (line for line in template.footer_text.splitlines() if line.strip()):
            rows.append(_center(footer_line, width))

    return "\n".join(rows) + "\n"
