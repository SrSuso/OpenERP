"""app.pricing.formula: the safe AST-walking evaluator (rule 12: never
eval()/exec()). Pure unit tests, no database."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.pricing.formula import FormulaError, evaluate, validate

SPEC_EXAMPLE = (
    "(cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)"
)

VARIABLES = {
    "cost": Decimal("10"),
    "tax_rate": Decimal("21"),
    "surcharge_rate": Decimal("5"),
    "margin_rate": Decimal("20"),
}


def test_the_spec_example_formula_evaluates_correctly() -> None:
    # cost=10, tax=21%, surcharge=5% -> 10 + 2.1 + 0.5 = 12.6; margin 20% -> 15.12
    result = evaluate(SPEC_EXAMPLE, VARIABLES)

    assert result == Decimal("15.120")


def test_basic_arithmetic_and_parentheses() -> None:
    assert evaluate("(1 + 2) * 3", {}) == Decimal("9")
    assert evaluate("10 / 4", {}) == Decimal("2.5")
    assert evaluate("-cost", {"cost": Decimal("5")}) == Decimal("-5")


def test_round_ceil_floor() -> None:
    assert evaluate("round(1.256, 2)", {}) == Decimal("1.26")
    assert evaluate("round(cost)", {"cost": Decimal("1.5")}) in (Decimal("2"), Decimal("2.0"))
    assert evaluate("ceil(1.1)", {}) == Decimal("2")
    assert evaluate("floor(1.9)", {}) == Decimal("1")


@pytest.mark.parametrize(
    "formula",
    [
        "__import__('os').system('echo pwned')",
        "().__class__.__bases__[0]",
        "open('/etc/passwd')",
        "cost.__class__",
        "[1, 2, 3]",
        "{1: 2}",
        "cost if cost > 0 else 0",
        "lambda: 1",
        "1 == 1",
        "cost; surcharge_rate",
        "exec('1')",
        "eval('1')",
    ],
)
def test_dangerous_or_disallowed_constructs_are_rejected(formula: str) -> None:
    with pytest.raises(FormulaError):
        validate(formula)
    with pytest.raises(FormulaError):
        evaluate(formula, VARIABLES)


def test_unknown_variable_is_rejected() -> None:
    with pytest.raises(FormulaError):
        validate("cost * unknown_variable")


def test_unknown_function_is_rejected() -> None:
    with pytest.raises(FormulaError):
        validate("abs(cost)")


def test_disallowed_operators_are_rejected() -> None:
    for formula in ("cost ** 2", "cost % 2", "cost // 2"):
        with pytest.raises(FormulaError):
            validate(formula)


def test_syntax_error_is_a_formula_error_not_a_crash() -> None:
    with pytest.raises(FormulaError):
        validate("cost + ")


def test_division_by_zero_is_a_formula_error() -> None:
    with pytest.raises(FormulaError):
        evaluate("cost / 0", VARIABLES)


def test_validate_does_not_require_variable_values() -> None:
    """validate() only checks structure/names, so a formula can be checked
    before there's a product to evaluate it against."""
    validate(SPEC_EXAMPLE)


def test_evaluate_requires_all_referenced_variables() -> None:
    with pytest.raises(FormulaError):
        evaluate("cost * tax_rate", {"cost": Decimal("1")})
