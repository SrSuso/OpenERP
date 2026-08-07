"""Rule #8: money and quantities are Decimal/NUMERIC(18,6), never float.

These assertions run against real PostgreSQL because the guarantee being
tested is a property of the database column type.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import Column, MetaData, String, Table, select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.db.types import MONEY_QUANTUM, NUMERIC_PRECISION, NUMERIC_SCALE, numeric

_metadata = MetaData()
_amounts = Table(
    "tmp_numeric_probe",
    _metadata,
    Column("label", String(50), primary_key=True),
    Column("value", numeric()),
)

# Values chosen because binary floating point cannot represent them exactly.
CASES = [
    ("cent", Decimal("0.01")),
    ("half-cent rounding trap", Decimal("1.005")),
    ("float trap", Decimal("0.1") + Decimal("0.2")),
    ("weight", Decimal("1.500")),
    ("small weight", Decimal("0.250")),
    ("micro unit", Decimal("0.000001")),
    ("large total", Decimal("999999999999.999999")),
]


@pytest.fixture
async def probe_table(connection: AsyncConnection) -> AsyncConnection:
    await connection.run_sync(_metadata.create_all)
    return connection


async def test_decimal_values_survive_a_round_trip(probe_table: AsyncConnection) -> None:
    await probe_table.execute(
        _amounts.insert(), [{"label": label, "value": value} for label, value in CASES]
    )

    rows = (await probe_table.execute(select(_amounts.c.label, _amounts.c.value))).all()
    stored: dict[str, object] = {row.label: row.value for row in rows}

    for label, expected in CASES:
        assert isinstance(stored[label], Decimal), f"{label} came back as {type(stored[label])}"
        assert stored[label] == expected, label


async def test_scale_is_six_decimal_places(probe_table: AsyncConnection) -> None:
    await probe_table.execute(_amounts.insert(), {"label": "x", "value": Decimal("2.5")})

    value = await probe_table.scalar(select(_amounts.c.value))

    assert isinstance(value, Decimal)
    assert str(value) == "2.500000"
    exponent = value.as_tuple().exponent
    assert isinstance(exponent, int) and -exponent == NUMERIC_SCALE


async def test_float_arithmetic_would_have_lost_money() -> None:
    """Guards the reason the rule exists, not the rule itself."""
    assert 0.1 + 0.2 != 0.3
    assert Decimal("0.1") + Decimal("0.2") == Decimal("0.3")


async def test_column_type_declares_precision_and_scale() -> None:
    column_type = numeric()

    assert column_type.precision == NUMERIC_PRECISION
    assert column_type.scale == NUMERIC_SCALE
    assert column_type.asdecimal is True
    assert Decimal("0.01") == MONEY_QUANTUM
