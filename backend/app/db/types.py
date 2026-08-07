"""Column types shared by every module.

Non-negotiable rule #8: money and quantities are ``NUMERIC(18,6)`` in
PostgreSQL and :class:`decimal.Decimal` in Python.  ``float`` must never touch
a monetary or quantity value, so these aliases are the only way modules should
declare such columns.

Usage::

    class SaleLine(Base):
        quantity: Mapped[Quantity]
        unit_price: Mapped[Money]
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from sqlalchemy import Numeric
from sqlalchemy.orm import mapped_column

#: Total digits / digits after the decimal point for all numeric business data.
NUMERIC_PRECISION = 18
NUMERIC_SCALE = 6

#: Smallest representable step at the storage scale.
NUMERIC_EPSILON = Decimal(1).scaleb(-NUMERIC_SCALE)

#: Rounding unit used when a value is presented or settled as currency.
#: Storage keeps 6 decimals; presentation/settlement rounds to 2.
MONEY_QUANTUM = Decimal("0.01")


def numeric() -> Numeric[Decimal]:
    """A fresh ``NUMERIC(18,6)`` instance returning ``Decimal``."""
    return Numeric(NUMERIC_PRECISION, NUMERIC_SCALE, asdecimal=True)


#: A monetary amount (price, cost, tax, total).
Money = Annotated[Decimal, mapped_column(numeric())]

#: A quantity, always expressed in the product's base unit.  Supports decimals
#: for goods sold by weight (1.500, 0.250).
Quantity = Annotated[Decimal, mapped_column(numeric())]

#: A percentage rate (tax, surcharge, margin), e.g. Decimal("21") for 21%.
Rate = Annotated[Decimal, mapped_column(numeric())]
