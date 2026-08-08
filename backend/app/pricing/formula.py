"""A safe pricing-formula evaluator.

Rule 12: pricing formulas never use ``eval()``/``exec()``. This parses a
formula with Python's ``ast`` module and interprets the tree itself, walking
only nodes on an explicit whitelist — arithmetic, parentheses (implicit in
the AST, not a node of their own), the four variable names in
:data:`ALLOWED_VARIABLES`, and calls to the three functions in
:data:`ALLOWED_FUNCTIONS`. Anything else (attribute access, subscripting,
comparisons, lambdas, calls to anything not on the list, ...) is rejected
by :func:`validate`/:func:`evaluate` before any computation happens — the
tree is never handed to Python's own evaluator.

Example formula (from the spec)::

    (cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)
"""

from __future__ import annotations

import ast
from collections.abc import Callable
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal

#: The only names a formula may reference. Every product carries all four
#: (see app.catalog.models.Product), so a formula can always be evaluated.
ALLOWED_VARIABLES = frozenset({"cost", "tax_rate", "surcharge_rate", "margin_rate"})


class FormulaError(ValueError):
    """The formula is malformed, uses a disallowed construct, references an
    unknown name, or fails at evaluation time (e.g. division by zero)."""


def _round(value: Decimal, ndigits: Decimal | int = 0) -> Decimal:
    return round(value, int(ndigits))


def _ceil(value: Decimal) -> Decimal:
    return value.to_integral_value(rounding=ROUND_CEILING)


def _floor(value: Decimal) -> Decimal:
    return value.to_integral_value(rounding=ROUND_FLOOR)


#: The only functions a formula may call.
ALLOWED_FUNCTIONS: dict[str, Callable[..., Decimal]] = {
    "round": _round,
    "ceil": _ceil,
    "floor": _floor,
}

_ALLOWED_BINOPS: tuple[type[ast.operator], ...] = (ast.Add, ast.Sub, ast.Mult, ast.Div)
_ALLOWED_UNARYOPS: tuple[type[ast.unaryop], ...] = (ast.UAdd, ast.USub)


def validate(formula: str) -> None:
    """Raise :class:`FormulaError` if ``formula`` is not safe to evaluate.
    Call this whenever a formula is created or edited — not only when it is
    eventually evaluated against a real product."""
    _parse(formula)


def evaluate(formula: str, variables: dict[str, Decimal]) -> Decimal:
    """Parse, validate and evaluate ``formula`` against ``variables``."""
    tree = _parse(formula)
    return _eval_node(tree.body, variables)


def _parse(formula: str) -> ast.Expression:
    try:
        tree = ast.parse(formula, mode="eval")
    except SyntaxError as exc:
        raise FormulaError(f"Invalid formula syntax: {exc.msg}") from exc
    _validate_node(tree.body)
    return tree


def _validate_node(node: ast.AST) -> None:
    if isinstance(node, ast.BinOp):
        if not isinstance(node.op, _ALLOWED_BINOPS):
            raise FormulaError(f"Operator {type(node.op).__name__} is not allowed.")
        _validate_node(node.left)
        _validate_node(node.right)
    elif isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, _ALLOWED_UNARYOPS):
            raise FormulaError(f"Unary operator {type(node.op).__name__} is not allowed.")
        _validate_node(node.operand)
    elif isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCTIONS:
            raise FormulaError("Only round(), ceil() and floor() may be called.")
        if node.keywords:
            raise FormulaError("Keyword arguments are not allowed.")
        for arg in node.args:
            _validate_node(arg)
    elif isinstance(node, ast.Name):
        if node.id not in ALLOWED_VARIABLES:
            raise FormulaError(
                f"Unknown variable {node.id!r}; allowed: {sorted(ALLOWED_VARIABLES)}."
            )
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, int | float):
            raise FormulaError("Only numeric constants are allowed.")
    else:
        raise FormulaError(f"{type(node).__name__} is not allowed in a pricing formula.")


def _eval_node(node: ast.AST, variables: dict[str, Decimal]) -> Decimal:
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left, variables)
        right = _eval_node(node.right, variables)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            if right == 0:
                raise FormulaError("Division by zero.")
            return left / right
        raise FormulaError(f"Operator {type(node.op).__name__} is not allowed.")
    if isinstance(node, ast.UnaryOp):
        value = _eval_node(node.operand, variables)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCTIONS:
            raise FormulaError("Only round(), ceil() and floor() may be called.")
        func = ALLOWED_FUNCTIONS[node.func.id]
        args = [_eval_node(arg, variables) for arg in node.args]
        return func(*args)
    if isinstance(node, ast.Name):
        if node.id not in variables:
            raise FormulaError(f"Missing value for variable {node.id!r}.")
        return variables[node.id]
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, int | float):
            raise FormulaError("Only numeric constants are allowed.")
        return Decimal(str(node.value))
    raise FormulaError(f"{type(node).__name__} is not allowed in a pricing formula.")
