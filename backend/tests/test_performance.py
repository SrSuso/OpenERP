"""Phase 20: pagination on unbounded lists, and the three indexes this
phase adds on ``status`` columns (``sales``, ``purchase_orders``,
``outbox_messages``) actually get used.

Every fixture here (warehouse, supplier, the bulk-inserted rows) is
created through ``committing_sessionmaker`` — a real, separate connection
that really commits — rather than through the API's own ``client`` (bound
to ``db_session``, a savepoint nested in a transaction that only ever
rolls back). A row ``client`` creates is invisible to any other
connection until that rollback, so seeding through ``client`` and then
bulk-inserting rows that reference it via ``committing_sessionmaker``
would fail on the foreign key. The direction that does work — writing
through ``committing_sessionmaker`` and reading back through
``client`` — works because Postgres's default READ COMMITTED isolation
gives every new statement a fresh snapshot of whatever is already
committed, regardless of which connection committed it. These tests are
responsible for their own data, same as every other
``committing_sessionmaker`` test in this suite.

Business-flow endpoints (checkout, purchase approval, ...) are
deliberately bypassed for seeding — they enforce rules unrelated to what
this phase tests (one draft sale per warehouse, stock availability, ...)
and would make seeding hundreds of rows far too slow.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.inventory import service as inventory_service
from app.jobs.models import OutboxMessage
from app.purchasing.models import PurchaseOrder, PurchaseOrderStatus
from app.sales.models import Sale, SaleStatus
from app.suppliers import service as suppliers_service
from app.suppliers.schemas import SupplierCreate

LoginFn = Callable[..., Awaitable[dict[str, Any]]]


async def _new_warehouse(session: AsyncSession) -> tuple[int, int]:
    warehouse = await inventory_service.create_warehouse(
        session, f"Perf test warehouse {uuid.uuid4().hex[:8]}"
    )
    location = await inventory_service.create_location(session, warehouse.id, "Almacén")
    return warehouse.id, location.id


async def _new_supplier(session: AsyncSession) -> int:
    supplier = await suppliers_service.create_supplier(
        session, SupplierCreate(name=f"Perf test supplier {uuid.uuid4().hex[:8]}")
    )
    return supplier.id


async def test_sales_pagination_covers_every_row_without_overlap(
    client: AsyncClient, login: LoginFn, committing_sessionmaker: async_sessionmaker
) -> None:
    await login(role_name="ADMIN")
    total = 25

    async with committing_sessionmaker() as session:
        warehouse_id, location_id = await _new_warehouse(session)
        await session.execute(
            insert(Sale),
            [
                {
                    "warehouse_id": warehouse_id,
                    "location_id": location_id,
                    "status": SaleStatus.CANCELLED,
                    "notes": f"perf-{i}",
                }
                for i in range(total)
            ],
        )
        await session.commit()

    seen_ids: set[int] = set()
    page_size = 10
    offset = 0
    while True:
        response = await client.get(
            "/api/v1/sales",
            params={"warehouse_id": warehouse_id, "limit": page_size, "offset": offset},
        )
        assert response.status_code == 200
        page = response.json()
        if not page:
            break
        page_ids = {row["id"] for row in page}
        assert not (page_ids & seen_ids), "a page repeated a row from an earlier page"
        seen_ids |= page_ids
        assert len(page) <= page_size
        offset += page_size

    assert len(seen_ids) == total


async def test_sales_limit_is_capped_at_500(client: AsyncClient, login: LoginFn) -> None:
    await login(role_name="ADMIN")
    response = await client.get("/api/v1/sales", params={"limit": 501})
    assert response.status_code == 422


async def test_the_phase_20_status_indexes_exist(
    committing_sessionmaker: async_sessionmaker,
) -> None:
    async with committing_sessionmaker() as session:
        rows = (
            (
                await session.execute(
                    text(
                        "select indexname from pg_indexes "
                        "where indexname in ("
                        "'ix_sales_status', "
                        "'ix_purchase_orders_status', "
                        "'ix_outbox_messages_status'"
                        ")"
                    )
                )
            )
            .scalars()
            .all()
        )
    assert set(rows) == {
        "ix_sales_status",
        "ix_purchase_orders_status",
        "ix_outbox_messages_status",
    }


async def test_the_outbox_status_index_is_actually_used_by_the_planner(
    committing_sessionmaker: async_sessionmaker,
) -> None:
    """The worker's claim query filters on ``status = 'PENDING'`` against a
    table that, in production, accumulates mostly ``SENT`` history — seed
    enough rows for that shape so the planner's cost estimate actually
    prefers the index over a sequential scan, rather than merely asserting
    the index exists (the test above already does that)."""
    async with committing_sessionmaker() as session:
        sent = [
            {"to_email": "x@example.com", "subject": "s", "body_text": "b", "status": "SENT"}
            for _ in range(4000)
        ]
        pending = [
            {"to_email": "x@example.com", "subject": "s", "body_text": "b", "status": "PENDING"}
            for _ in range(5)
        ]
        await session.execute(insert(OutboxMessage), sent + pending)
        await session.commit()
        await session.execute(text("analyze outbox_messages"))

        plan = (
            await session.execute(
                text(
                    "explain (format json) select id from outbox_messages where status = 'PENDING'"
                )
            )
        ).scalar_one()

    plan_text = str(plan)
    assert "Seq Scan" not in plan_text, (
        f"expected the planner to use ix_outbox_messages_status, got: {plan_text}"
    )


async def test_purchase_orders_pagination(
    client: AsyncClient, login: LoginFn, committing_sessionmaker: async_sessionmaker
) -> None:
    await login(role_name="ADMIN")
    total = 12

    async with committing_sessionmaker() as session:
        supplier_id = await _new_supplier(session)
        await session.execute(
            insert(PurchaseOrder),
            [
                {"supplier_id": supplier_id, "status": PurchaseOrderStatus.DRAFT}
                for _ in range(total)
            ],
        )
        await session.commit()

    first_page = (
        await client.get(
            "/api/v1/purchase-orders",
            params={"supplier_id": supplier_id, "limit": 5, "offset": 0},
        )
    ).json()
    second_page = (
        await client.get(
            "/api/v1/purchase-orders",
            params={"supplier_id": supplier_id, "limit": 5, "offset": 5},
        )
    ).json()
    assert len(first_page) == 5
    assert len(second_page) == 5
    assert {o["id"] for o in first_page}.isdisjoint({o["id"] for o in second_page})


async def test_listing_many_sales_stays_fast(
    client: AsyncClient, login: LoginFn, committing_sessionmaker: async_sessionmaker
) -> None:
    """Not a real load-testing tool (see phase 20's own docs entry for that
    boundary) — a coarse smoke check that a paginated, indexed list query
    stays comfortably fast with a few hundred rows behind it, so a future
    regression that reintroduces an unpaginated full scan gets caught."""
    await login(role_name="ADMIN")

    async with committing_sessionmaker() as session:
        warehouse_id, location_id = await _new_warehouse(session)
        await session.execute(
            insert(Sale),
            [
                {
                    "warehouse_id": warehouse_id,
                    "location_id": location_id,
                    "status": SaleStatus.COMPLETED,
                    "notes": f"perf-{i}",
                }
                for i in range(500)
            ],
        )
        await session.commit()

    started = time.perf_counter()
    response = await client.get(
        "/api/v1/sales",
        params={"warehouse_id": warehouse_id, "status": "COMPLETED", "limit": 50},
    )
    elapsed = time.perf_counter() - started

    assert response.status_code == 200
    assert len(response.json()) == 50
    assert elapsed < 2.0, f"GET /sales took {elapsed:.2f}s for 500 rows behind it"
