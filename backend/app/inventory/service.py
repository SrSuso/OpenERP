"""The inventory ledger: recording movements and maintaining the
``stock_balance`` projection.

:func:`record_movement` is the single choke point every phase from here on
must go through to change stock — phase 9 (receipts), phase 11 (sales),
phase 14 (returns) all call it rather than touching ``stock_balance``
directly. It writes the movement and folds it into the balance in the same
transaction (rule 5), atomically, via Postgres' own
``INSERT ... ON CONFLICT DO UPDATE`` — the mechanism phase 11's checkout
concurrency depends on.

That atomic-upsert is deliberate, not just a style choice: a plain
"``SELECT ... FOR UPDATE``, insert if missing" only locks rows that already
exist, so two concurrent movements against a *new* product/warehouse/
location key can both see "no row" and both try to insert one, and the
second loses to the unique constraint. ``ON CONFLICT DO UPDATE`` folds the
lookup, lock and increment into one statement Postgres itself serialises.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.catalog import stock as catalog_stock
from app.catalog.models import Product
from app.core.context import get_user_id
from app.core.errors import NotFoundError, ValidationError
from app.inventory.models import Location, StockBalance, StockMovement, Warehouse
from app.inventory.schemas import AdjustmentCreate, TransferCreate
from app.lots.models import Lot

# --- warehouses / locations --------------------------------------------------


async def list_warehouses(session: AsyncSession, *, active_only: bool = True) -> list[Warehouse]:
    stmt = select(Warehouse).order_by(Warehouse.name)
    if active_only:
        stmt = stmt.where(Warehouse.is_active.is_(True))
    return list((await session.execute(stmt)).scalars())


async def create_warehouse(session: AsyncSession, name: str) -> Warehouse:
    warehouse = Warehouse(name=name)
    session.add(warehouse)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="warehouse",
        entity_id=warehouse.id,
        after={"name": name},
    )
    return warehouse


async def _warehouse_or_404(session: AsyncSession, warehouse_id: int) -> Warehouse:
    warehouse = await session.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFoundError(f"Warehouse {warehouse_id} not found.")
    return warehouse


async def list_locations(
    session: AsyncSession, warehouse_id: int, *, active_only: bool = True
) -> list[Location]:
    await _warehouse_or_404(session, warehouse_id)
    stmt = select(Location).where(Location.warehouse_id == warehouse_id).order_by(Location.name)
    if active_only:
        stmt = stmt.where(Location.is_active.is_(True))
    return list((await session.execute(stmt)).scalars())


async def create_location(session: AsyncSession, warehouse_id: int, name: str) -> Location:
    await _warehouse_or_404(session, warehouse_id)
    location = Location(warehouse_id=warehouse_id, name=name)
    session.add(location)
    await session.flush()
    await audit.record(
        session,
        action="created",
        entity_type="location",
        entity_id=location.id,
        after={"warehouse_id": warehouse_id, "name": name},
    )
    return location


# --- the ledger ----------------------------------------------------------------


@dataclass(frozen=True)
class InventoryContext:
    """Rows that define one coherent inventory coordinate."""

    product: Product
    warehouse: Warehouse
    location: Location
    lot: Lot | None


async def validate_stock_location(
    session: AsyncSession, *, warehouse_id: int, location_id: int
) -> tuple[Warehouse, Location]:
    """Ensure a location belongs to the warehouse named by an operation."""
    warehouse = await session.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise ValidationError(f"Warehouse {warehouse_id} does not exist.")
    location = await session.get(Location, location_id)
    if location is None:
        raise ValidationError(f"Location {location_id} does not exist.")
    if location.warehouse_id != warehouse_id:
        raise ValidationError(
            f"Location {location_id} does not belong to warehouse {warehouse_id}."
        )
    return warehouse, location


async def validate_inventory_context(
    session: AsyncSession,
    *,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    lot_id: int | None,
    enforce_lot_policy: bool = True,
) -> InventoryContext:
    """Validate the cross-row invariants of one stock coordinate.

    ``enforce_lot_policy=False`` is only for operations such as a FEFO plan
    that validate product/location before selecting the concrete lots. A
    materialised movement always uses the default and therefore cannot skip
    the product's current ``track_lots`` policy.
    """
    product = await session.get(Product, product_id)
    if product is None:
        raise ValidationError(f"Product {product_id} does not exist.")
    warehouse, location = await validate_stock_location(
        session, warehouse_id=warehouse_id, location_id=location_id
    )

    lot: Lot | None = None
    if lot_id is not None:
        lot = await session.get(Lot, lot_id)
        if lot is None:
            raise ValidationError(f"Lot {lot_id} does not exist.")
        if lot.product_id != product_id:
            raise ValidationError(f"Lot {lot_id} does not belong to product {product_id}.")

    if enforce_lot_policy:
        if catalog_stock.tracks_lots(product) and lot is None:
            raise ValidationError(f"Product {product_id} tracks lots; lot_id is required.")
        if not catalog_stock.tracks_lots(product) and lot is not None:
            raise ValidationError(f"Product {product_id} does not track lots; lot_id is forbidden.")

    return InventoryContext(product=product, warehouse=warehouse, location=location, lot=lot)


async def _upsert_balance(
    session: AsyncSession,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    lot_id: int | None,
    quantity: Decimal,
) -> None:
    """Atomically create-or-increment the balance row for this key. Safe
    under concurrency for both an existing row (Postgres locks it for the
    statement's duration) and a not-yet-existing one (the unique index
    itself arbitrates which concurrent inserter wins the row; the other
    falls through to the ``DO UPDATE`` and increments it).

    ``lot_id`` picks which of ``stock_balance``'s two partial unique
    indexes is the conflict arbiter — see the model's docstring for why a
    single nullable-column index can't do this safely.
    """
    stmt = pg_insert(StockBalance).values(
        product_id=product_id,
        warehouse_id=warehouse_id,
        location_id=location_id,
        lot_id=lot_id,
        quantity=quantity,
    )
    if lot_id is None:
        stmt = stmt.on_conflict_do_update(
            index_elements=[
                StockBalance.product_id,
                StockBalance.warehouse_id,
                StockBalance.location_id,
            ],
            index_where=StockBalance.lot_id.is_(None),
            set_={"quantity": StockBalance.quantity + stmt.excluded.quantity},
        )
    else:
        stmt = stmt.on_conflict_do_update(
            index_elements=[
                StockBalance.product_id,
                StockBalance.warehouse_id,
                StockBalance.location_id,
                StockBalance.lot_id,
            ],
            index_where=StockBalance.lot_id.is_not(None),
            set_={"quantity": StockBalance.quantity + stmt.excluded.quantity},
        )
    await session.execute(stmt)


async def _lock_exact_balance_quantity(
    session: AsyncSession,
    *,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    lot_id: int | None,
) -> Decimal:
    """Lock and read the exact source coordinate a negative movement spends."""
    stmt = select(StockBalance.quantity).where(
        StockBalance.product_id == product_id,
        StockBalance.warehouse_id == warehouse_id,
        StockBalance.location_id == location_id,
    )
    if lot_id is None:
        stmt = stmt.where(StockBalance.lot_id.is_(None))
    else:
        stmt = stmt.where(StockBalance.lot_id == lot_id)
    quantity = (await session.execute(stmt.with_for_update())).scalar_one_or_none()
    return quantity if quantity is not None else Decimal(0)


async def record_movement(
    session: AsyncSession,
    *,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    quantity: Decimal,
    movement_type: str,
    unit_cost: Decimal,
    lot_id: int | None = None,
    reference_type: str | None = None,
    reference_id: int | None = None,
    allow_negative: bool = False,
) -> StockMovement:
    """Write one ledger entry and fold it into ``stock_balance``, atomically
    (rule 5). ``quantity`` is signed: positive increases stock, negative
    decreases it. ``lot_id`` (phase 8): omit for products that don't track
    lots. Negative balances are rejected unless the caller represents an
    existing explicit exception (a signed manual adjustment or the shop's
    ``sales.allow_negative_stock`` setting)."""
    await validate_inventory_context(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        location_id=location_id,
        lot_id=lot_id,
    )
    if quantity < 0 and not allow_negative:
        available = await _lock_exact_balance_quantity(
            session,
            product_id=product_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            lot_id=lot_id,
        )
        if available + quantity < 0:
            raise ValidationError(
                f"Insufficient stock for product {product_id}: needs {-quantity}, "
                f"only {available} available at location {location_id}."
            )

    movement = StockMovement(
        product_id=product_id,
        warehouse_id=warehouse_id,
        location_id=location_id,
        quantity=quantity,
        movement_type=movement_type,
        reference_type=reference_type,
        reference_id=reference_id,
        unit_cost=unit_cost,
        lot_id=lot_id,
        user_id=get_user_id(),
    )
    session.add(movement)

    await _upsert_balance(session, product_id, warehouse_id, location_id, lot_id, quantity)

    await session.flush()
    # Same class of bug as app.catalog.service: without a refresh, `quantity`
    # stays the exact Decimal passed in (e.g. "-2") instead of the
    # NUMERIC(18,6)-normalised value Postgres stored ("-2.000000") — same
    # number, inconsistent precision versus every other field in the API.
    await session.refresh(movement)
    return movement


async def lock_and_get_available_quantity(
    session: AsyncSession, *, product_id: int, warehouse_id: int, location_id: int
) -> Decimal:
    """Row-lock every ``stock_balance`` row for this product/location
    (every lot, plus the no-lot row if the product doesn't track lots) and
    return their total.

    This is what makes phase 13's checkout stock check race-free: locking
    first and only writing the decrement afterwards, *in the same
    transaction*, means a second concurrent checkout for the same
    product/location blocks on this statement until the first commits or
    rolls back — it can never see the same "enough stock" snapshot the
    first one already spent. (Postgres refuses ``FOR UPDATE`` together with
    an aggregate, hence locking the rows first and summing in Python rather
    than a single ``SELECT SUM(...) ... FOR UPDATE``.)

    A product with no balance row at all (never moved) correctly locks
    nothing and returns 0 — there is nothing to race over.
    """
    stmt = (
        select(StockBalance.quantity)
        .where(
            StockBalance.product_id == product_id,
            StockBalance.warehouse_id == warehouse_id,
            StockBalance.location_id == location_id,
        )
        # A checkout may need several lot rows. Locking them by primary key
        # gives every concurrent sale the same acquisition order regardless
        # of its FEFO plan or the query planner's preferred scan.
        .order_by(StockBalance.id)
        .with_for_update()
    )
    rows = (await session.execute(stmt)).scalars().all()
    return sum(rows, Decimal(0))


async def get_available_quantity(
    session: AsyncSession, *, product_id: int, warehouse_id: int, location_id: int
) -> Decimal:
    """Read the current quantity without reserving it.

    This is deliberately for advisory UI checks such as opening the POS
    payment screen. Only :func:`lock_and_get_available_quantity` is safe
    to decide a checkout, because it retains row locks until the stock
    decrement commits.
    """
    rows = (
        await session.execute(
            select(StockBalance.quantity).where(
                StockBalance.product_id == product_id,
                StockBalance.warehouse_id == warehouse_id,
                StockBalance.location_id == location_id,
            )
        )
    ).scalars()
    return sum(rows, Decimal(0))


async def record_adjustment(session: AsyncSession, payload: AdjustmentCreate) -> StockMovement:
    lot_id = payload.lot_id
    if payload.lot_number is not None:
        # A count made on the shop floor identifies a lot by the number on
        # its package, never by an internal database id.  Resolve/create it
        # before writing the movement, in this request's one transaction.
        context = await validate_inventory_context(
            session,
            product_id=payload.product_id,
            warehouse_id=payload.warehouse_id,
            location_id=payload.location_id,
            lot_id=None,
            enforce_lot_policy=False,
        )
        if not catalog_stock.tracks_lots(context.product):
            raise ValidationError(f"Product {payload.product_id} does not track lots.")
        if context.product.track_expiration and payload.expiration_date is None:
            raise ValidationError(
                f"Product {payload.product_id} tracks expiration; expiration_date is required."
            )
        from app.lots.schemas import LotCreate
        from app.lots.service import get_or_create_lot

        lot = await get_or_create_lot(
            session,
            LotCreate(
                product_id=payload.product_id,
                lot_number=payload.lot_number,
                expiration_date=payload.expiration_date,
            ),
        )
        lot_id = lot.id

    movement = await record_movement(
        session,
        product_id=payload.product_id,
        warehouse_id=payload.warehouse_id,
        location_id=payload.location_id,
        quantity=payload.quantity,
        movement_type=payload.movement_type,
        unit_cost=payload.unit_cost,
        lot_id=lot_id,
        # Signed ADJUSTMENT is the explicit administrative correction
        # mechanism and historically permits a negative resulting balance.
        # WASTE is an ordinary consumption and must have stock to consume.
        allow_negative=payload.movement_type == "ADJUSTMENT",
    )
    await audit.record(
        session,
        action=movement.movement_type.lower(),
        entity_type="product",
        entity_id=payload.product_id,
        after={
            "quantity": str(payload.quantity),
            "warehouse_id": payload.warehouse_id,
            "location_id": payload.location_id,
            "lot_id": lot_id,
            "lot_number": payload.lot_number,
            "reason": payload.reason,
        },
    )
    return movement


async def record_transfer(
    session: AsyncSession, payload: TransferCreate
) -> tuple[StockMovement, StockMovement]:
    if (payload.from_warehouse_id, payload.from_location_id) == (
        payload.to_warehouse_id,
        payload.to_location_id,
    ):
        raise ValidationError("Source and destination location are the same.")

    # Validate both halves before writing either. record_movement repeats the
    # choke-point validation (served from this session's identity map), so a
    # future direct caller cannot bypass it.
    await validate_inventory_context(
        session,
        product_id=payload.product_id,
        warehouse_id=payload.from_warehouse_id,
        location_id=payload.from_location_id,
        lot_id=payload.lot_id,
    )
    await validate_inventory_context(
        session,
        product_id=payload.product_id,
        warehouse_id=payload.to_warehouse_id,
        location_id=payload.to_location_id,
        lot_id=payload.lot_id,
    )

    out_movement = await record_movement(
        session,
        product_id=payload.product_id,
        warehouse_id=payload.from_warehouse_id,
        location_id=payload.from_location_id,
        quantity=-payload.quantity,
        movement_type="TRANSFER_OUT",
        unit_cost=payload.unit_cost,
        lot_id=payload.lot_id,
        reference_type="transfer",
    )
    in_movement = await record_movement(
        session,
        product_id=payload.product_id,
        warehouse_id=payload.to_warehouse_id,
        location_id=payload.to_location_id,
        quantity=payload.quantity,
        movement_type="TRANSFER_IN",
        unit_cost=payload.unit_cost,
        lot_id=payload.lot_id,
        reference_type="transfer",
        reference_id=out_movement.id,
    )
    await audit.record(
        session,
        action="transfer",
        entity_type="product",
        entity_id=payload.product_id,
        after={
            "quantity": str(payload.quantity),
            "lot_id": payload.lot_id,
            "from": [payload.from_warehouse_id, payload.from_location_id],
            "to": [payload.to_warehouse_id, payload.to_location_id],
        },
    )
    return out_movement, in_movement


async def list_movements(
    session: AsyncSession,
    *,
    product_id: int | None = None,
    warehouse_id: int | None = None,
    location_id: int | None = None,
    lot_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[StockMovement]:
    stmt = select(StockMovement).order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
    if product_id is not None:
        stmt = stmt.where(StockMovement.product_id == product_id)
    if warehouse_id is not None:
        stmt = stmt.where(StockMovement.warehouse_id == warehouse_id)
    if location_id is not None:
        stmt = stmt.where(StockMovement.location_id == location_id)
    if lot_id is not None:
        stmt = stmt.where(StockMovement.lot_id == lot_id)
    stmt = stmt.limit(limit).offset(offset)
    return list((await session.execute(stmt)).scalars())


async def list_balances(
    session: AsyncSession,
    *,
    product_id: int | None = None,
    warehouse_id: int | None = None,
    lot_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[StockBalance]:
    stmt = (
        select(StockBalance)
        .order_by(StockBalance.product_id, StockBalance.id)
        .limit(limit)
        .offset(offset)
    )
    if product_id is not None:
        stmt = stmt.where(StockBalance.product_id == product_id)
    if warehouse_id is not None:
        stmt = stmt.where(StockBalance.warehouse_id == warehouse_id)
    if lot_id is not None:
        stmt = stmt.where(StockBalance.lot_id == lot_id)
    return list((await session.execute(stmt)).scalars())


async def names_by_id(session: AsyncSession) -> tuple[dict[int, str], dict[int, str]]:
    """Almacenes y ubicaciones por id, para poner nombres a un listado de
    saldos sin una consulta por fila. Una tienda tiene un puñado de cada
    cosa, así que se traen enteros."""
    warehouses = await session.execute(select(Warehouse.id, Warehouse.name))
    locations = await session.execute(select(Location.id, Location.name))
    return ({row.id: row.name for row in warehouses}, {row.id: row.name for row in locations})


async def total_quantity_by_product(
    session: AsyncSession, *, warehouse_id: int | None = None
) -> dict[int, Decimal]:
    """Cuánto hay de cada producto, sumando ubicaciones y lotes — lo que
    enseña la columna de stock de la lista de productos. Se suma aquí y no
    en el cliente porque el listado de saldos viene paginado."""
    stmt = select(StockBalance.product_id, func.sum(StockBalance.quantity)).group_by(
        StockBalance.product_id
    )
    if warehouse_id is not None:
        stmt = stmt.where(StockBalance.warehouse_id == warehouse_id)
    rows = await session.execute(stmt)
    return {row[0]: row[1] for row in rows}


async def rebuild_stock_balance(session: AsyncSession) -> int:
    """Delete every ``stock_balance`` row and reconstruct it by summing
    ``stock_movements`` — the capability rule 2 requires: the projection
    must always be fully rebuildable from the ledger. Returns the number of
    balance rows written."""
    await session.execute(delete(StockBalance))

    totals_stmt = select(
        StockMovement.product_id,
        StockMovement.warehouse_id,
        StockMovement.location_id,
        StockMovement.lot_id,
        func.sum(StockMovement.quantity).label("total"),
    ).group_by(
        StockMovement.product_id,
        StockMovement.warehouse_id,
        StockMovement.location_id,
        StockMovement.lot_id,
    )
    rows = (await session.execute(totals_stmt)).all()

    for product_id, warehouse_id, location_id, lot_id, total in rows:
        session.add(
            StockBalance(
                product_id=product_id,
                warehouse_id=warehouse_id,
                location_id=location_id,
                lot_id=lot_id,
                quantity=total,
            )
        )
    await session.flush()

    await audit.record(
        session,
        action="rebuilt",
        entity_type="stock_balance",
        entity_id=None,
        after={"rows": len(rows)},
    )
    return len(rows)
