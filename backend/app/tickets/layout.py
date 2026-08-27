"""Small, deterministic receipt-layout language.

This is deliberately *not* a general template engine: receipt templates are
edited by administrators and must never be able to execute Python, access the
filesystem or call a command.  It supports only values, alignment filters and
the three receipt collections documented in the UI.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


class TicketLayoutError(ValueError):
    """A safe, user-facing template syntax error."""


_TAG_RE = re.compile(r"(\{\{.*?\}\}|\{%.*?%\})", re.DOTALL)
_VARIABLE_RE = re.compile(r"^[a-z_]+(?:\.[a-z_]+)*$")
_FILTER_RE = re.compile(r"^(left|right|center)(?::([1-9]\d{0,2}))?$")
_FOR_RE = re.compile(r"^for\s+(line|payment|tax)\s+in\s+(sale\.lines|sale\.payments|sale\.taxes)$")

_LOOPS = {
    "line": "sale.lines",
    "payment": "sale.payments",
    "tax": "sale.taxes",
}
_VARIABLES = {
    "separator",
    "store.name",
    "store.tax_id",
    "store.address",
    "store.phone",
    "template.header",
    "template.footer",
    "sale.number",
    "sale.date",
    "sale.cashier",
    "totals.subtotal",
    "totals.tax",
    "totals.total",
    "totals.tendered",
    "totals.change",
    "labels.total",
    "labels.change",
    "labels.cash",
    "labels.card",
    "labels.other",
    "labels.tax_note",
    "line.name",
    "line.quantity",
    "line.unit_price",
    "line.total",
    "line.discount",
    "line.tax_rate",
    "payment.label",
    "payment.amount",
    "tax.rate",
    "tax.base",
    "tax.amount",
}


@dataclass(frozen=True)
class _Text:
    value: str


@dataclass(frozen=True)
class _Variable:
    expression: str


@dataclass(frozen=True)
class _Loop:
    item: str
    collection: str
    children: tuple[_Text | _Variable | _Loop, ...]


_Node = _Text | _Variable | _Loop


def _validate_variable(expression: str) -> None:
    parts = [part.strip() for part in expression.split("|")]
    if not parts or not _VARIABLE_RE.fullmatch(parts[0]) or parts[0] not in _VARIABLES:
        raise TicketLayoutError(f"Variable no permitida: {{{{{expression}}}}}")
    for filter_text in parts[1:]:
        if _FILTER_RE.fullmatch(filter_text) is None:
            raise TicketLayoutError(
                f"Filtro no permitido en {{{{{expression}}}}}. Usa left, right o center."
            )


def _parse(source: str) -> tuple[_Node, ...]:
    chunks = _TAG_RE.split(source)

    def read(start: int, *, in_loop: bool) -> tuple[tuple[_Node, ...], int]:
        nodes: list[_Node] = []
        index = start
        while index < len(chunks):
            chunk = chunks[index]
            if chunk.startswith("{{") and chunk.endswith("}}"):
                expression = chunk[2:-2].strip()
                _validate_variable(expression)
                nodes.append(_Variable(expression))
            elif chunk.startswith("{%") and chunk.endswith("%}"):
                statement = chunk[2:-2].strip()
                if statement == "endfor":
                    if not in_loop:
                        raise TicketLayoutError(
                            "{% endfor %} no tiene un {% for %} correspondiente."
                        )
                    return tuple(nodes), index + 1
                match = _FOR_RE.fullmatch(statement)
                if match is None:
                    raise TicketLayoutError(
                        "Bloque no permitido. Usa {% for line in sale.lines %}, "
                        "{% for payment in sale.payments %} o {% for tax in sale.taxes %}."
                    )
                if in_loop:
                    raise TicketLayoutError("No se permiten bucles dentro de otros bucles.")
                item, collection = match.groups()
                children, index = read(index + 1, in_loop=True)
                nodes.append(_Loop(item, collection, children))
                continue
            elif "{{" in chunk or "{%" in chunk or "}}" in chunk or "%}" in chunk:
                raise TicketLayoutError("Etiqueta de plantilla sin cerrar.")
            else:
                nodes.append(_Text(chunk))
            index += 1
        if in_loop:
            raise TicketLayoutError("Falta {% endfor %} al final del bucle.")
        return tuple(nodes), index

    nodes, _ = read(0, in_loop=False)
    return nodes


def validate_layout_template(source: str) -> None:
    """Validate syntax at API boundaries, before a template is saved."""
    if len(source) > 8_000:
        raise TicketLayoutError("El diseño del ticket no puede superar 8000 caracteres.")
    if source.strip():
        _parse(source)


def _lookup(path: str, context: Mapping[str, Any]) -> str:
    value: Any = context
    for key in path.split("."):
        if not isinstance(value, Mapping) or key not in value:
            raise TicketLayoutError(f"Variable no disponible al imprimir: {path}")
        value = value[key]
    return str(value)


def _render_expression(expression: str, context: Mapping[str, Any], width: int) -> str:
    parts = [part.strip() for part in expression.split("|")]
    value = _lookup(parts[0], context)
    for filter_text in parts[1:]:
        match = _FILTER_RE.fullmatch(filter_text)
        assert match is not None  # checked by _parse
        alignment, specified_width = match.groups()
        target_width = int(specified_width) if specified_width else width
        if alignment == "left":
            value = value[:target_width].ljust(target_width)
        elif alignment == "right":
            value = value[-target_width:].rjust(target_width)
        else:
            value = value[:target_width].center(target_width)
    return value


def _render_nodes(nodes: tuple[_Node, ...], context: Mapping[str, Any], width: int) -> str:
    rendered: list[str] = []
    for node in nodes:
        if isinstance(node, _Text):
            rendered.append(node.value)
        elif isinstance(node, _Variable):
            rendered.append(_render_expression(node.expression, context, width))
        else:
            sale = context.get("sale")
            collection_name = node.collection.rsplit(".", 1)[-1]
            if not isinstance(sale, Mapping) or not isinstance(sale.get(collection_name), list):
                raise TicketLayoutError(f"Colección no disponible al imprimir: {node.collection}")
            collection = sale[collection_name]
            for value in collection:
                rendered.append(_render_nodes(node.children, {**context, node.item: value}, width))
    return "".join(rendered)


def render_layout_template(source: str, context: Mapping[str, Any], width: int) -> str:
    """Render a validated layout and wrap long output safely for thermal paper."""
    nodes = _parse(source)
    raw = _render_nodes(nodes, context, width)
    rows: list[str] = []
    for line in raw.splitlines():
        if not line:
            rows.append("")
            continue
        while len(line) > width:
            rows.append(line[:width].rstrip())
            line = line[width:]
        rows.append(line.rstrip())
    return "\n".join(rows) + "\n"
