"""Pure rendering: a ``Sale`` + a ``TicketTemplate`` in, a monospace
58mm/80mm receipt string out. No I/O, no database access — everything this
needs is already loaded on the ORM objects passed in, which is what keeps
it trivially unit-testable and keeps ``app.tickets.service`` the only place
that decides *when* a ticket gets generated (once, ever, per sale).
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.sales.models import Sale, SaleLine
from app.tickets.models import TicketTaxDisplay, TicketTemplate

#: Characters a standard monospace receipt font fits per line, for each
#: supported roll width — the two off only because thermal printers only
#: come in these two widths in practice.
CHARS_PER_WIDTH: dict[int, int] = {58: 32, 80: 48}

_CENTS = Decimal("0.01")


def _money(value: Decimal) -> str:
    return f"{value.quantize(_CENTS, rounding=ROUND_HALF_UP):.2f}"


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
    subtotal = line.quantity_base * line.unit_price
    discount_amount = subtotal * line.discount_rate / Decimal(100)
    remaining = subtotal - discount_amount
    if prices_include_tax:
        net = remaining / (Decimal(1) + line.tax_rate / Decimal(100))
        tax_amount = remaining - net
        return net, tax_amount, remaining
    tax_amount = remaining * line.tax_rate / Decimal(100)
    return remaining, tax_amount, remaining + tax_amount


def render_ticket(
    sale: Sale,
    template: TicketTemplate,
    *,
    prices_include_tax: bool,
    settings: Mapping[str, Any],
    cashier_name: str | None = None,
) -> str:
    """``settings`` is `app.settings.store.get_values`' output — the shop's
    own wording, formats and on/off switches (see
    `app.settings.registry`). Kept as a plain mapping rather than a typed
    object on purpose: a new option is then one registry entry and one
    lookup here, with nothing in between to keep in step."""
    width = CHARS_PER_WIDTH[template.width_mm]
    rows: list[str] = []

    # Datos de la tienda antes de la cabecera libre de la plantilla: quien
    # los rellena en Configuración no debería tener que repetirlos ahí.
    store_lines = [
        *str(settings["store.name"]).splitlines(),
        *str(settings["store.tax_id"]).splitlines(),
        *str(settings["store.address"]).splitlines(),
        *str(settings["store.phone"]).splitlines(),
    ]
    for store_line in (line for line in store_lines if line.strip()):
        rows.append(_center(store_line, width))
    for header_line in (line for line in template.header_text.splitlines() if line.strip()):
        rows.append(_center(header_line, width))
    if rows:
        rows.append(_rule(width))

    rows.append(f"{settings['ticket.sale_number_prefix']}{sale.id}")
    when = sale.completed_at or sale.created_at
    rows.append(when.strftime(str(settings["ticket.date_format"])))
    if settings["ticket.show_cashier"] and cashier_name:
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
        rows.extend(_two_column(line.product.name, _money(total), width))
        if settings["ticket.show_unit_price"]:
            rows.append(f"{_quantity(line.quantity_packages)} x {_money(line.unit_price)}")
        if template.show_line_discounts and line.discount_rate > 0:
            rows.extend(
                _two_column(
                    f"{settings['ticket.label_discount']} {_rate_label(line.discount_rate)}%",
                    f"-{_money(discount_amount)}",
                    width,
                )
            )

    tax_total = sum(tax_by_rate.values(), start=Decimal(0))
    total = subtotal + tax_total
    tax_note = str(settings["ticket.tax_note"])
    rows.append(_rule(width))
    rows.extend(_two_column(str(settings["ticket.label_total"]), _money(total), width))

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
        "CASH": str(settings["ticket.label_cash"]),
        "CARD": str(settings["ticket.label_card"]),
        "OTHER": str(settings["ticket.label_other"]),
    }
    for payment in sale.payments:
        method = method_labels.get(payment.method, payment.method)
        rows.extend(_two_column(method, _money(payment.amount), width))
    tendered = sum((p.amount for p in sale.payments), start=Decimal(0))
    change = tendered - total
    if change > 0:
        rows.extend(_two_column(str(settings["ticket.label_change"]), _money(change), width))

    if template.footer_text.strip():
        rows.append(_rule(width))
        for footer_line in (line for line in template.footer_text.splitlines() if line.strip()):
            rows.append(_center(footer_line, width))

    return "\n".join(rows) + "\n"
