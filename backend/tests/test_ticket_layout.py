"""Unit tests for the deliberately small, safe receipt-layout language."""

from __future__ import annotations

import pytest

from app.tickets.layout import TicketLayoutError, render_layout_template, validate_layout_template

CONTEXT = {
    "separator": "-" * 20,
    "store": {"name": "Comercial Barbosa", "tax_id": "B123", "address": "Calle 1", "phone": ""},
    "template": {"header": "", "footer": "Gracias"},
    "sale": {
        "number": "0001",
        "date": "28/08/2026 10:00",
        "cashier": "María",
        "lines": [
            {
                "name": "Agua",
                "quantity": "2",
                "unit_price": "0.95",
                "total": "1.90",
                "discount": "0.00",
                "tax_rate": "10",
            }
        ],
        "payments": [{"label": "Efectivo", "amount": "2.00"}],
        "taxes": [{"rate": "10", "base": "1.73", "amount": "0.17"}],
    },
    "totals": {
        "subtotal": "1.73",
        "tax": "0.17",
        "total": "1.90",
        "tendered": "2.00",
        "change": "0.10",
    },
    "labels": {
        "total": "TOTAL",
        "change": "Cambio",
        "cash": "Efectivo",
        "card": "Tarjeta",
        "other": "Otros",
        "tax_note": "IVA incluido",
    },
}


def test_renders_values_loops_and_alignment_without_executing_code() -> None:
    source = (
        "{{ store.name | center }}\n{{ separator }}\n"
        "{% for line in sale.lines %}"
        "{{ line.name | left:14 }}{{ line.total | right:6 }}\n"
        "{% endfor %}"
        "{{ labels.total | left:14 }}{{ totals.total | right:6 }}"
    )

    rendered = render_layout_template(source, CONTEXT, 20)

    assert "Comercial Barbosa" in rendered
    assert "Agua" in rendered
    assert rendered.splitlines()[-1] == "TOTAL           1.90"


@pytest.mark.parametrize(
    "source",
    [
        "{{ __import__.system }}",
        "{% if sale.number %}x{% endif %}",
        "{% for product in sale.lines %}x{% endfor %}",
        "{% for line in sale.lines %}x",
        "{% endfor %}",
        "{{ sale.total | eval }}",
    ],
)
def test_rejects_anything_outside_the_receipt_language(source: str) -> None:
    with pytest.raises(TicketLayoutError):
        validate_layout_template(source)
