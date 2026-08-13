"""Transaction-scoped accounting cut for one warehouse.

Checkout, returns and Z closing all pass through the same PostgreSQL
advisory lock.  The lock key contains the warehouse id, so independent tills
do not block one another, and its cost is constant regardless of Z history.

The global acquisition order is: idempotency record, warehouse accounting
cut, aggregate root (Sale), stock/lot rows, and finally sale numbering.  A Z
close stops after the accounting cut; it never acquires a Sale or stock lock.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

# ASCII "ZREP", kept inside PostgreSQL's signed int32 range.  Using the
# two-int advisory-lock namespace avoids collisions with the unrelated
# one-key locks used for sale numbering and lot creation.
_Z_REPORT_LOCK_NAMESPACE = 0x5A524550


async def lock_warehouse_cut(session: AsyncSession, warehouse_id: int) -> None:
    """Serialize economic mutations and Z cuts for one warehouse."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:namespace, :warehouse_id)"),
        {"namespace": _Z_REPORT_LOCK_NAMESPACE, "warehouse_id": warehouse_id},
    )


async def database_clock(session: AsyncSession) -> datetime:
    """Wall-clock timestamp, not PostgreSQL's transaction-start ``now()``."""
    value = await session.scalar(select(text("clock_timestamp()")))
    assert isinstance(value, datetime)
    return value
