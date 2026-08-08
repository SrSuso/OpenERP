"""Pure rendering: a ``Sale`` + a ``TicketTemplate`` in, a monospace
58mm/80mm receipt string out. No I/O, no database access — everything this
needs is already loaded on the ORM objects passed in, which is what keeps
it trivially unit-testable and keeps ``app.tickets.service`` the only place
that decides *when* a ticket gets generated (once, ever, per sale).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from app.sales.models import Sale, SaleLine
from app.tickets.models import TicketTemplate

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


def _line_total(line: SaleLine) -> Decimal:
    subtotal = line.quantity_base * line.unit_price
    discount_amount = subtotal * line.discount_rate / Decimal(100)
    net = subtotal - discount_amount
    tax_amount = net * line.tax_rate / Decimal(100)
    return net + tax_amount


def render_ticket(sale: Sale, template: TicketTemplate) -> str:
    width = CHARS_PER_WIDTH[template.width_mm]
    rows: list[str] = []

    for header_line in (line for line in template.header_text.splitlines() if line.strip()):
        rows.append(_center(header_line, width))
    if template.header_text.strip():
        rows.append(_rule(width))

    rows.append(f"Venta #{sale.id}")
    when = sale.completed_at or sale.created_at
    rows.append(when.strftime("%Y-%m-%d %H:%M"))
    rows.append(_rule(width))

    subtotal = Decimal(0)
    tax_total = Decimal(0)
    for line in sale.lines:
        total = _line_total(line)
        subtotal_line = line.quantity_base * line.unit_price
        discount_amount = subtotal_line * line.discount_rate / Decimal(100)
        net = subtotal_line - discount_amount
        tax_total += net * line.tax_rate / Decimal(100)
        subtotal += net
        rows.extend(_two_column(line.product.name, _money(total), width))
        qty = f"{_quantity(line.quantity_packages)} x {_money(line.unit_price)}"
        rows.append(qty)

    rows.append(_rule(width))
    if template.show_tax_breakdown:
        rows.extend(_two_column("Base imponible", _money(subtotal), width))
        rows.extend(_two_column("Impuestos", _money(tax_total), width))
    total = subtotal + tax_total
    rows.extend(_two_column("TOTAL", _money(total), width))
    rows.append(_rule(width))

    for payment in sale.payments:
        method = {"CASH": "Efectivo", "CARD": "Tarjeta", "OTHER": "Otro"}.get(
            payment.method, payment.method
        )
        rows.extend(_two_column(method, _money(payment.amount), width))
    tendered = sum((p.amount for p in sale.payments), start=Decimal(0))
    change = tendered - total
    if change > 0:
        rows.extend(_two_column("Cambio", _money(change), width))

    if template.footer_text.strip():
        rows.append(_rule(width))
        for footer_line in (line for line in template.footer_text.splitlines() if line.strip()):
            rows.append(_center(footer_line, width))

    return "\n".join(rows) + "\n"
