"""The migration chain is the only way the schema changes.

``alembic check`` is the important one: it fails as soon as a model is added
without a matching migration, which is the usual way a codebase and its
database drift apart.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncConnection

from tests.conftest import run_alembic

pytestmark = [pytest.mark.integration, pytest.mark.migration]

AlembicRunner = Callable[..., str]


def _sync_engine(url: str):  # type: ignore[no-untyped-def]
    """Use the project's psycopg 3 driver for direct migration fixtures."""
    return create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))


def _insert_sale_fixture(connection, *, status: str) -> tuple[int, int]:  # type: ignore[no-untyped-def]
    product_id = connection.scalar(
        text(
            "INSERT INTO products (sku, name, description, base_unit_name, cost, list_price, "
            "tax_rate, min_stock, track_lots, track_expiration, is_active, created_at, updated_at) "
            "VALUES ('MIGRATION-SALE', 'Producto migración', '', 'UD', 2.5, 10, 21, 0, "
            "false, false, true, now(), now()) RETURNING id"
        )
    )
    package_id = connection.scalar(
        text(
            "INSERT INTO product_packages (product_id, name, factor, is_base, created_at, "
            "updated_at) VALUES (:product_id, 'UD', 1, true, now(), now()) RETURNING id"
        ),
        {"product_id": product_id},
    )
    warehouse_id, location_id = connection.execute(
        text(
            "SELECT w.id, l.id FROM warehouses AS w "
            "JOIN locations AS l ON l.warehouse_id = w.id ORDER BY w.id, l.id LIMIT 1"
        )
    ).one()
    sale_id = connection.scalar(
        text(
            "INSERT INTO sales (warehouse_id, location_id, status, notes, completed_at, "
            "created_at, updated_at) VALUES (:warehouse_id, :location_id, :status, '', "
            ":completed_at, now(), now()) "
            "RETURNING id"
        ),
        {
            "warehouse_id": warehouse_id,
            "location_id": location_id,
            "status": status,
            "completed_at": datetime.now(UTC) if status == "COMPLETED" else None,
        },
    )
    line_id = connection.scalar(
        text(
            "INSERT INTO sale_lines (sale_id, product_id, package_id, package_name, "
            "package_factor, quantity_packages, quantity_base, unit_price, tax_rate, "
            "discount_rate, created_at, updated_at) VALUES (:sale_id, :product_id, "
            ":package_id, 'UD', 1, 1, 1, 10, 21, 0, now(), now()) RETURNING id"
        ),
        {"sale_id": sale_id, "product_id": product_id, "package_id": package_id},
    )
    return sale_id, line_id


async def test_database_is_at_head(connection: AsyncConnection) -> None:
    version = await connection.scalar(text("SELECT version_num FROM alembic_version"))

    assert version, "test database was not migrated"


def test_there_is_exactly_one_head(alembic_runner: AlembicRunner) -> None:
    heads = [line for line in alembic_runner("heads").splitlines() if line.strip()]

    assert len(heads) == 1, f"branched migration history: {heads}"


def test_models_and_migrations_are_in_sync(alembic_runner: AlembicRunner) -> None:
    """No model change is left without a migration."""
    output = alembic_runner("check")

    assert "No new upgrade operations detected" in output


def test_downgrade_and_upgrade_round_trip(fresh_database: Callable[[], str]) -> None:
    """Every migration must be reversible, so a bad deploy can be rolled back.

    Runs on its own database: downgrading to base drops every table, which
    would pull the rug out from under the rest of the session.
    """
    url = fresh_database()

    assert "(head)" not in run_alembic(url, "current")

    run_alembic(url, "upgrade", "head")
    assert "(head)" in run_alembic(url, "current")

    run_alembic(url, "downgrade", "base")
    assert "(head)" not in run_alembic(url, "current")

    run_alembic(url, "upgrade", "head")
    assert "(head)" in run_alembic(url, "current")


def test_checkout_idempotency_migration_is_reversible(
    fresh_database: Callable[[], str],
) -> None:
    url = fresh_database()
    run_alembic(url, "upgrade", "72f3c8a91d04")
    engine = _sync_engine(url)

    run_alembic(url, "upgrade", "51a2d7c9e4b6")
    with engine.begin() as connection:
        columns = set(
            connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'idempotency_records'"
                )
            ).scalars()
        )
        constraints = set(
            connection.execute(
                text(
                    "SELECT constraint_name FROM information_schema.table_constraints "
                    "WHERE table_schema = 'public' AND table_name = 'idempotency_records'"
                )
            ).scalars()
        )
    assert {
        "id",
        "operation",
        "idempotency_key",
        "request_fingerprint",
        "resource_id",
        "actor_user_id",
        "created_at",
        "completed_at",
    } == columns
    assert "uq_idempotency_records_operation_key" in constraints

    run_alembic(url, "downgrade", "72f3c8a91d04")
    with engine.begin() as connection:
        assert connection.scalar(text("SELECT to_regclass('public.idempotency_records')")) is None
    run_alembic(url, "upgrade", "head")
    engine.dispose()


def test_idempotency_result_resource_migration_is_reversible(
    fresh_database: Callable[[], str],
) -> None:
    url = fresh_database()
    run_alembic(url, "upgrade", "51a2d7c9e4b6")
    engine = _sync_engine(url)

    run_alembic(url, "upgrade", "8c4e2a7f1b93")
    with engine.begin() as connection:
        columns = set(
            connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'idempotency_records'"
                )
            ).scalars()
        )
    assert "result_resource_id" in columns

    run_alembic(url, "downgrade", "51a2d7c9e4b6")
    with engine.begin() as connection:
        columns = set(
            connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'idempotency_records'"
                )
            ).scalars()
        )
    assert "result_resource_id" not in columns
    run_alembic(url, "upgrade", "head")
    engine.dispose()


def test_pos_terminal_migration_preserves_existing_sales_and_is_reversible(
    fresh_database: Callable[[], str],
) -> None:
    url = fresh_database()
    run_alembic(url, "upgrade", "8c4e2a7f1b93")
    engine = _sync_engine(url)

    with engine.begin() as connection:
        warehouse_id, location_id = connection.execute(
            text(
                "SELECT w.id, l.id FROM warehouses AS w "
                "JOIN locations AS l ON l.warehouse_id = w.id ORDER BY w.id, l.id LIMIT 1"
            )
        ).one()
        historical_sale_id = connection.scalar(
            text(
                "INSERT INTO sales (warehouse_id, location_id, status, notes, created_at, "
                "updated_at) VALUES (:warehouse_id, :location_id, 'DRAFT', '', now(), now()) "
                "RETURNING id"
            ),
            {"warehouse_id": warehouse_id, "location_id": location_id},
        )

    run_alembic(url, "upgrade", "3e7b1c9d5a42")
    with engine.begin() as connection:
        assert (
            connection.scalar(
                text("SELECT terminal_id FROM sales WHERE id = :id"), {"id": historical_sale_id}
            )
            is None
        )
        columns = set(
            connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'pos_terminals'"
                )
            ).scalars()
        )
        indexes = set(
            connection.execute(
                text(
                    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' "
                    "AND tablename = 'sales'"
                )
            ).scalars()
        )
    assert {"id", "name", "warehouse_id", "is_active", "created_at", "updated_at"} == columns
    assert "ix_sales_terminal_id_status" in indexes

    run_alembic(url, "downgrade", "8c4e2a7f1b93")
    with engine.begin() as connection:
        assert connection.scalar(text("SELECT to_regclass('public.pos_terminals')")) is None
        sale_columns = set(
            connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'sales'"
                )
            ).scalars()
        )
    assert "terminal_id" not in sale_columns
    run_alembic(url, "upgrade", "head")
    engine.dispose()


def test_a_formula_naming_margin_amount_blocks_without_data_loss(
    fresh_database: Callable[[], str],
) -> None:
    """An ambiguous formula requires review instead of being erased."""
    url = fresh_database()
    run_alembic(url, "upgrade", "c9b41e7a02d5")

    engine = _sync_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO product_categories (name, is_active, price_formula, tracks_stock, "
                "created_at, updated_at) "
                "VALUES ('Con fórmula', true, 'cost * 2 + margin_amount', true, now(), now())"
            )
        )
        connection.execute(text("UPDATE pricing_settings SET formula = 'margin_amount + cost'"))

    with pytest.raises(RuntimeError, match="explicit review"):
        run_alembic(url, "upgrade", "head")

    with engine.begin() as connection:
        category_formula = connection.scalar(
            text("SELECT price_formula FROM product_categories WHERE name = 'Con fórmula'")
        )
        store_formula = connection.scalar(text("SELECT formula FROM pricing_settings"))
        # Explicit reconciliation: these are business decisions, not guesses
        # embedded in a migration.
        connection.execute(
            text(
                "UPDATE product_categories SET price_formula = 'cost * 2' "
                "WHERE name = 'Con fórmula'"
            )
        )
        connection.execute(text("UPDATE pricing_settings SET formula = 'cost'"))

    assert category_formula == "cost * 2 + margin_amount"
    assert store_formula == "margin_amount + cost"
    run_alembic(url, "upgrade", "head")
    engine.dispose()


@pytest.mark.parametrize("prices_include_tax", [False, True])
def test_explicit_fiscal_mode_and_valid_formulas_survive_upgrade(
    fresh_database: Callable[[], str], prices_include_tax: bool
) -> None:
    url = fresh_database()
    run_alembic(url, "upgrade", "547ee9f06037")
    engine = _sync_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE pricing_settings SET formula = 'cost * 2', prices_include_tax = :mode"),
            {"mode": prices_include_tax},
        )

    run_alembic(url, "upgrade", "c9b41e7a02d5")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO product_categories (name, is_active, price_formula, tracks_stock, "
                "created_at, updated_at) "
                "VALUES ('Fórmula válida', true, 'cost * 3', true, now(), now())"
            )
        )
    run_alembic(url, "upgrade", "head")

    with engine.begin() as connection:
        saved_mode = connection.scalar(text("SELECT prices_include_tax FROM pricing_settings"))
        store_formula = connection.scalar(text("SELECT formula FROM pricing_settings"))
        category_formula = connection.scalar(
            text("SELECT price_formula FROM product_categories WHERE name = 'Fórmula válida'")
        )
    engine.dispose()
    assert saved_mode is prices_include_tax
    assert store_formula == "cost * 2"
    assert category_formula == "cost * 3"


def test_custom_formula_requires_explicit_fiscal_mode(fresh_database: Callable[[], str]) -> None:
    url = fresh_database()
    run_alembic(url, "upgrade", "547ee9f06037")
    engine = _sync_engine(url)
    with engine.begin() as connection:
        connection.execute(text("UPDATE pricing_settings SET formula = 'cost + tax_rate'"))

    with pytest.raises(RuntimeError, match="Cannot infer prices_include_tax"):
        run_alembic(url, "upgrade", "5b4760e2a878")
    with engine.begin() as connection:
        assert connection.scalar(text("SELECT formula FROM pricing_settings")) == "cost + tax_rate"
        assert connection.scalar(text("SELECT prices_include_tax FROM pricing_settings")) is None
        connection.execute(text("UPDATE pricing_settings SET prices_include_tax = false"))

    run_alembic(url, "upgrade", "head")
    engine.dispose()


def test_cancelled_sales_and_lines_survive_upgrade(fresh_database: Callable[[], str]) -> None:
    url = fresh_database()
    run_alembic(url, "upgrade", "e2b93a75c614")
    engine = _sync_engine(url)
    with engine.begin() as connection:
        sale_id, line_id = _insert_sale_fixture(connection, status="CANCELLED")

    run_alembic(url, "upgrade", "head")
    with engine.begin() as connection:
        sale = connection.execute(
            text("SELECT status, number FROM sales WHERE id = :id"), {"id": sale_id}
        ).one()
        line = connection.execute(
            text("SELECT product_sku, product_name, unit_cost FROM sale_lines WHERE id = :id"),
            {"id": line_id},
        ).one()
    engine.dispose()
    assert sale == ("CANCELLED", None)
    assert line == ("MIGRATION-SALE", "Producto migración", 2.5)


def test_completed_legacy_sale_requires_explicit_snapshot_reconciliation(
    fresh_database: Callable[[], str],
) -> None:
    url = fresh_database()
    run_alembic(url, "upgrade", "d1f83c60a97e")
    engine = _sync_engine(url)
    with engine.begin() as connection:
        sale_id, line_id = _insert_sale_fixture(connection, status="COMPLETED")

    with pytest.raises(RuntimeError, match="explicit prices_include_tax snapshot"):
        run_alembic(url, "upgrade", "head")

    run_alembic(url, "upgrade", "7f2a6c9e4b10")
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE sales SET prices_include_tax = true WHERE id = :id"), {"id": sale_id}
        )
    run_alembic(url, "upgrade", "4c8d1e7a5b32")
    run_alembic(url, "upgrade", "9a3e6b1c7d42")
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE sale_lines SET product_sku = 'MIGRATION-SALE', "
                "product_name = 'Producto migración', unit_cost = 2.5, "
                "tracks_stock = true, track_lots = false WHERE id = :id"
            ),
            {"id": line_id},
        )
    run_alembic(url, "upgrade", "head")
    with engine.begin() as connection:
        saved = connection.execute(
            text(
                "SELECT s.prices_include_tax, sl.product_sku, sl.unit_cost "
                "FROM sales AS s JOIN sale_lines AS sl ON sl.sale_id = s.id "
                "WHERE s.id = :id"
            ),
            {"id": sale_id},
        ).one()
    engine.dispose()
    assert saved == (True, "MIGRATION-SALE", 2.5)
