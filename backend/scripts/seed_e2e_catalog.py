"""Seed a minimal, real catalog for the Playwright E2E suite and local dev.

Without this, `/pos` has a warehouse/location (seeded by the phase 7
migration) but nothing to sell — the grid would always render its empty
state. Since phase 13, checking out also needs actual stock (checkout
validates availability before it will complete a sale), so this seeds a
generous quantity of each product too. Since phase 15, printing a ticket
needs an active `TicketTemplate` to exist at all, so this seeds a default
one too. Idempotent — safe to run on every CI job / local E2E run; does
nothing to a POS category, product or ticket template that already exists
(matched by name/SKU/"any template already active", respectively). Stock
is only seeded the moment a product is *created*, not topped up on later
runs — same philosophy as `seed_e2e_users.py` (acts once, doesn't "fix up"
state on every call); re-seed a depleted local database with
`uv run python -m scripts.devdb reset && make db-upgrade && make seed-e2e
&& make seed-e2e-catalog` if a long local testing session runs it dry.

Usage::

    uv run python -m scripts.seed_e2e_catalog
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select

from app.catalog import service as catalog
from app.catalog.models import PosCategory, Product
from app.catalog.schemas import PosCategoryCreate, ProductCreate
from app.db import registry as _registry  # noqa: F401 — registers every ORM model
from app.db.session import session_scope
from app.inventory import service as inventory
from app.inventory.models import Location, Warehouse
from app.tickets import service as tickets
from app.tickets.models import TicketTemplate
from app.tickets.schemas import TicketTemplateCreate

#: Comfortably more than any E2E run will check out.
_SEEDED_STOCK = Decimal(1000)


@dataclass(frozen=True)
class _ProductSpec:
    sku: str
    name: str
    base_unit_name: str
    base_barcode: str
    cost: Decimal
    list_price: Decimal
    tax_rate: Decimal


_POS_CATEGORY_NAME = "Bebidas"

_PRODUCTS = (
    _ProductSpec(
        sku="LECHE-1L",
        name="Leche entera 1L",
        base_unit_name="Brick",
        base_barcode="8410000000010",
        cost=Decimal("0.80"),
        list_price=Decimal("1.20"),
        tax_rate=Decimal("10"),
    ),
    _ProductSpec(
        sku="AGUA-1500",
        name="Agua mineral 1.5L",
        base_unit_name="Botella",
        base_barcode="8410000000027",
        cost=Decimal("0.30"),
        list_price=Decimal("0.60"),
        tax_rate=Decimal("10"),
    ),
)


async def _seed() -> int:
    async with session_scope() as session:
        warehouse = (
            await session.execute(select(Warehouse).where(Warehouse.name == "Tienda principal"))
        ).scalar_one()
        location = (
            await session.execute(
                select(Location).where(
                    Location.warehouse_id == warehouse.id, Location.name == "Almacén"
                )
            )
        ).scalar_one()

        category = (
            await session.execute(select(PosCategory).where(PosCategory.name == _POS_CATEGORY_NAME))
        ).scalar_one_or_none()
        if category is None:
            category = await catalog.create_pos_category(
                session, PosCategoryCreate(name=_POS_CATEGORY_NAME, color="#0ea5e9")
            )
            print(f"created POS category: {category.name}")
        else:
            print(f"already present: POS category {category.name}")

        for spec in _PRODUCTS:
            existing = (
                await session.execute(select(Product).where(Product.sku == spec.sku))
            ).scalar_one_or_none()
            if existing is not None:
                print(f"already present: product {spec.sku}")
                continue

            product = await catalog.create_product(
                session,
                ProductCreate(
                    sku=spec.sku,
                    name=spec.name,
                    pos_category_id=category.id,
                    base_unit_name=spec.base_unit_name,
                    base_barcode=spec.base_barcode,
                    cost=spec.cost,
                    list_price=spec.list_price,
                    tax_rate=spec.tax_rate,
                ),
            )
            await inventory.record_movement(
                session,
                product_id=product.id,
                warehouse_id=warehouse.id,
                location_id=location.id,
                quantity=_SEEDED_STOCK,
                movement_type="ADJUSTMENT",
                unit_cost=spec.cost,
            )
            print(f"created product: {spec.sku} (stocked {_SEEDED_STOCK})")

        has_active_template = (
            await session.execute(select(TicketTemplate).where(TicketTemplate.is_active.is_(True)))
        ).scalar_one_or_none()
        if has_active_template is None:
            await tickets.create_template(
                session,
                TicketTemplateCreate(
                    name="Estándar",
                    width_mm=58,
                    header_text="OpenERP\nTienda de ejemplo",
                    footer_text="Gracias por su compra",
                ),
            )
            print("created ticket template: Estándar")
        else:
            print(f"already present: active ticket template {has_active_template.name}")
    return 0


def main() -> int:
    return asyncio.run(_seed())


if __name__ == "__main__":
    raise SystemExit(main())
