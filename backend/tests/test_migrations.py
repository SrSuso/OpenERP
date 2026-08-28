"""The migration chain is the only way the schema changes.

``alembic check`` is the important one: it fails as soon as a model is added
without a matching migration, which is the usual way a codebase and its
database drift apart.
"""

from __future__ import annotations

import json
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


def test_v2_alert_migration_preserves_product_behaviour_and_purges_legacy(
    fresh_database: Callable[[], str],
) -> None:
    url = fresh_database()
    run_alembic(url, "upgrade", "e8b3c7d5a2f1")
    engine = _sync_engine(url)
    with engine.begin() as connection:
        custom_product_id = connection.scalar(
            text(
                "INSERT INTO products "
                "(sku, name, description, base_unit_name, cost, list_price, tax_rate, min_stock, "
                "track_lots, track_expiration, is_active, created_at, updated_at) VALUES "
                "('MIG-ALERT-CUSTOM', 'Con mínimo', '', 'UDS.', 1, 2, 0, 10, false, false, "
                "true, now(), now()) RETURNING id"
            )
        )
        disabled_product_id = connection.scalar(
            text(
                "INSERT INTO products "
                "(sku, name, description, base_unit_name, cost, list_price, tax_rate, min_stock, "
                "track_lots, track_expiration, is_active, created_at, updated_at) VALUES "
                "('MIG-ALERT-OFF', 'Sin mínimo', '', 'UDS.', 1, 2, 0, 0, false, false, "
                "true, now(), now()) RETURNING id"
            )
        )
        connection.execute(
            text(
                "INSERT INTO settings (key, value, created_at, updated_at) VALUES "
                "('catalog.default_min_stock', '6.5', now(), now()), "
                "('notifications.default_expiration_days', '9', now(), now())"
            )
        )

        def add_rule(name: str, rule_type: str, params: dict[str, object]) -> int:
            return int(
                connection.scalar(
                    text(
                        "INSERT INTO notification_rules "
                        "(name, rule_type, params, severity, is_active, created_at, updated_at) "
                        "VALUES (:name, :rule_type, CAST(:params AS jsonb), 'LOW', true, now(), "
                        "now()) RETURNING id"
                    ),
                    {"name": name, "rule_type": rule_type, "params": json.dumps(params)},
                )
            )

        managed_low_id = add_rule("Stock V2", "LOW_STOCK", {"automatic": True})
        legacy_low_id = add_rule("Stock antiguo", "LOW_STOCK", {})
        condition_id = add_rule(
            "Condición antigua",
            "CONDITION",
            {"subject": "products", "conditions": []},
        )
        general_expiration_id = add_rule(
            "Caducidad general",
            "EXPIRING_LOT",
            {"managed": True, "product_id": None, "days_before_expiration": 5},
        )
        specific_expiration_id = add_rule(
            "Caducidad específica",
            "EXPIRING_LOT",
            {
                "managed": True,
                "product_id": custom_product_id,
                "days_before_expiration": 2,
            },
        )
        duplicate_specific_id = add_rule(
            "Caducidad duplicada",
            "EXPIRING_LOT",
            {
                "managed": True,
                "product_id": custom_product_id,
                "days_before_expiration": 3,
            },
        )
        legacy_expiration_id = add_rule(
            "Caducidad antigua",
            "EXPIRING_LOT",
            {"days_before_expiration": 15},
        )
        all_rule_ids = [
            managed_low_id,
            legacy_low_id,
            condition_id,
            general_expiration_id,
            specific_expiration_id,
            duplicate_specific_id,
            legacy_expiration_id,
        ]
        for rule_id in all_rule_ids:
            connection.execute(
                text(
                    "INSERT INTO incidents "
                    "(rule_id, subject_type, subject_id, message, status, first_detected_at, "
                    "last_seen_at, created_at, updated_at) VALUES "
                    "(:rule_id, 'product', :subject_id, 'legacy', 'OPEN', "
                    "now(), now(), now(), now())"
                ),
                {"rule_id": rule_id, "subject_id": rule_id},
            )

    run_alembic(url, "upgrade", "f4c2a8d91e73")
    with engine.begin() as connection:
        products = connection.execute(
            text(
                "SELECT id, stock_alert_mode, min_stock FROM products "
                "WHERE id IN (:custom_id, :disabled_id) ORDER BY id"
            ),
            {"custom_id": custom_product_id, "disabled_id": disabled_product_id},
        ).all()
        kept_rules = connection.execute(
            text("SELECT id, rule_type, params FROM notification_rules ORDER BY id")
        ).all()
        incident_rule_ids = set(connection.execute(text("SELECT rule_id FROM incidents")).scalars())
        retired_settings = connection.scalar(
            text(
                "SELECT count(*) FROM settings WHERE key IN "
                "('catalog.default_min_stock', 'notifications.default_expiration_days')"
            )
        )

    assert products == [
        (custom_product_id, "CUSTOM", 10),
        (disabled_product_id, "DISABLED", 0),
    ]
    assert [row.id for row in kept_rules] == [
        managed_low_id,
        general_expiration_id,
        specific_expiration_id,
    ]
    low_params = next(row.params for row in kept_rules if row.id == managed_low_id)
    assert low_params == {
        "automatic": True,
        "warehouse_id": None,
        "enabled": True,
        "min_stock": "6.5",
    }
    assert incident_rule_ids == {
        managed_low_id,
        general_expiration_id,
        specific_expiration_id,
    }
    assert retired_settings == 0
    engine.dispose()


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


def test_infrastructure_settings_migration_purges_only_infrastructure(
    fresh_database: Callable[[], str],
) -> None:
    """Legacy process settings and SMTP secrets disappear permanently.

    A downgrade restores only the old table shape.  It must neither invent
    secrets nor remove the functional settings that remain owned by the shop.
    """
    url = fresh_database()
    run_alembic(url, "upgrade", "b7e2c4a91d63")
    engine = _sync_engine(url)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO settings (key, value, created_at, updated_at) VALUES "
                "('server.database_url', 'postgresql://fake:secret@legacy/db', now(), now()), "
                "('server.bootstrap_admin_password', 'obviously-fake-password', now(), now()), "
                "('business.timezone', 'Europe/Lisbon', now(), now())"
            )
        )
        connection.execute(
            text(
                "INSERT INTO system_settings "
                "(smtp_host, smtp_password, notification_recipient_email) VALUES "
                "('smtp.example.invalid', 'obviously-fake-smtp-secret', "
                "'operator@example.invalid')"
            )
        )

    run_alembic(url, "upgrade", "e4a7c2d91b65")
    with engine.begin() as connection:
        server_keys = connection.scalars(
            text("SELECT key FROM settings WHERE key LIKE 'server.%'")
        ).all()
        timezone = connection.scalar(
            text("SELECT value FROM settings WHERE key = 'business.timezone'")
        )
        system_settings = connection.scalar(text("SELECT to_regclass('public.system_settings')"))
    assert server_keys == []
    assert timezone == "Europe/Lisbon"
    assert system_settings is None

    run_alembic(url, "downgrade", "b7e2c4a91d63")
    with engine.begin() as connection:
        assert connection.scalar(text("SELECT count(*) FROM system_settings")) == 0
        assert (
            connection.scalar(text("SELECT count(*) FROM settings WHERE key LIKE 'server.%'")) == 0
        )
        assert (
            connection.scalar(text("SELECT value FROM settings WHERE key = 'business.timezone'"))
            == "Europe/Lisbon"
        )

    run_alembic(url, "upgrade", "head")
    engine.dispose()


def test_single_active_ticket_template_migration_requires_explicit_reconciliation(
    fresh_database: Callable[[], str],
) -> None:
    """Ambiguous active layouts are never resolved by arbitrary id order."""
    url = fresh_database()
    run_alembic(url, "upgrade", "e4a7c2d91b65")
    engine = _sync_engine(url)
    with engine.begin() as connection:
        ids = list(
            connection.scalars(
                text(
                    "INSERT INTO ticket_templates "
                    "(name, width_mm, header_text, footer_text, is_active) VALUES "
                    "('Migration active A', 58, 'A', '', true), "
                    "('Migration active B', 58, 'B', '', true) RETURNING id"
                )
            )
        )

    with pytest.raises(RuntimeError, match="found 2 active templates"):
        run_alembic(url, "upgrade", "f5c8a1d42e76")
    with engine.begin() as connection:
        active_ids = list(
            connection.scalars(text("SELECT id FROM ticket_templates WHERE is_active ORDER BY id"))
        )
        # An operator deliberately selects B; the migration did not choose it.
        connection.execute(
            text("UPDATE ticket_templates SET is_active = false WHERE id = :id"),
            {"id": ids[0]},
        )
    assert active_ids == ids

    run_alembic(url, "upgrade", "f5c8a1d42e76")
    with engine.begin() as connection:
        index = connection.execute(
            text(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' "
                "AND indexname = 'uq_ticket_templates_single_active'"
            )
        ).scalar_one()
    assert "UNIQUE INDEX" in index
    assert "WHERE is_active" in index

    run_alembic(url, "downgrade", "e4a7c2d91b65")
    with engine.begin() as connection:
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' "
                    "AND indexname = 'uq_ticket_templates_single_active'"
                )
            )
            == 0
        )
        connection.execute(
            text("UPDATE ticket_templates SET is_active = true WHERE id = :id"),
            {"id": ids[0]},
        )
        # Leave a valid state before re-applying the migration.
        connection.execute(
            text("UPDATE ticket_templates SET is_active = false WHERE id = :id"),
            {"id": ids[1]},
        )

    run_alembic(url, "upgrade", "head")
    engine.dispose()


def test_ticket_editor_migration_centres_existing_layouts_and_preserves_custom_mode(
    fresh_database: Callable[[], str],
) -> None:
    url = fresh_database()
    run_alembic(url, "upgrade", "d2e6f5a1c4b8")
    engine = _sync_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO ticket_templates "
                "(name, printable_width_mm, header_text, footer_text, tax_display, "
                "is_active, layout_template) VALUES "
                "('Personalizada anterior', 64, '', '', 'BREAKDOWN', true, "
                "'{{ totals.total }}'), "
                "('Estándar anterior', 72, '', '', 'BREAKDOWN', false, '')"
            )
        )

    run_alembic(url, "upgrade", "e8b3c7d5a2f1")
    with engine.begin() as connection:
        rows = connection.execute(
            text(
                "SELECT name, margin_left_mm, margin_right_mm, layout_mode "
                "FROM ticket_templates ORDER BY name"
            )
        ).all()

    assert rows == [
        ("Estándar anterior", 4, 4, "STANDARD"),
        ("Personalizada anterior", 8, 8, "CUSTOM"),
    ]

    run_alembic(url, "downgrade", "d2e6f5a1c4b8")
    with engine.begin() as connection:
        assert (
            connection.scalar(
                text(
                    "SELECT layout_template FROM ticket_templates "
                    "WHERE name = 'Personalizada anterior'"
                )
            )
            == "{{ totals.total }}"
        )

    run_alembic(url, "upgrade", "head")
    engine.dispose()


def test_return_quantity_migration_backfills_every_legacy_effect(
    fresh_database: Callable[[], str],
) -> None:
    """Economic-only, physical-only and combined history are unambiguous."""
    url = fresh_database()
    run_alembic(url, "upgrade", "3e7b1c9d5a42")
    engine = _sync_engine(url)

    with engine.begin() as connection:
        warehouse_id, location_id = connection.execute(
            text(
                "SELECT w.id, l.id FROM warehouses AS w "
                "JOIN locations AS l ON l.warehouse_id = w.id ORDER BY w.id, l.id LIMIT 1"
            )
        ).one()
        product_id = connection.scalar(
            text(
                "INSERT INTO products "
                "(sku, name, description, base_unit_name, cost, list_price, tax_rate, min_stock, "
                "track_lots, track_expiration, is_active, created_at, updated_at) "
                "VALUES ('RETURN-BACKFILL', 'Return backfill', '', 'UD', 1, 10, 0, 0, false, "
                "false, true, now(), now()) RETURNING id"
            )
        )
        package_id = connection.scalar(
            text(
                "INSERT INTO product_packages "
                "(product_id, name, factor, is_base, created_at, updated_at) "
                "VALUES (:product_id, 'UD', 1, true, now(), now()) RETURNING id"
            ),
            {"product_id": product_id},
        )
        sale_id = connection.scalar(
            text(
                "INSERT INTO sales "
                "(warehouse_id, location_id, status, notes, completed_at, prices_include_tax, "
                "created_at, updated_at) VALUES "
                "(:warehouse_id, :location_id, 'COMPLETED', '', now(), true, now(), now()) "
                "RETURNING id"
            ),
            {"warehouse_id": warehouse_id, "location_id": location_id},
        )
        line_ids: list[int] = []
        for returned in (2, 3, 4, 1):
            line_ids.append(
                connection.scalar(
                    text(
                        "INSERT INTO sale_lines "
                        "(sale_id, product_id, product_sku, product_name, package_id, "
                        "package_name, "
                        "package_factor, quantity_packages, quantity_base, quantity_returned, "
                        "unit_price, unit_cost, tracks_stock, track_lots, tax_rate, discount_rate, "
                        "created_at, updated_at) VALUES "
                        "(:sale_id, :product_id, 'RETURN-BACKFILL', 'Return backfill', "
                        ":package_id, 'UD', 1, 10, 10, :returned, 10, 1, true, false, 0, 0, "
                        "now(), now()) RETURNING id"
                    ),
                    {
                        "sale_id": sale_id,
                        "product_id": product_id,
                        "package_id": package_id,
                        "returned": returned,
                    },
                )
            )

        for line_id, quantity, economic, physical in (
            (line_ids[0], 2, True, False),
            (line_ids[1], 3, False, True),
            (line_ids[2], 4, True, True),
            (line_ids[3], 1, False, False),
        ):
            return_id = connection.scalar(
                text(
                    "INSERT INTO returns "
                    "(sale_id, notes, created_at, updated_at) "
                    "VALUES (:sale_id, '', now(), now()) RETURNING id"
                ),
                {"sale_id": sale_id},
            )
            connection.execute(
                text(
                    "INSERT INTO return_lines "
                    "(return_id, sale_line_id, product_id, package_id, package_name, "
                    "package_factor, quantity_packages, quantity_base, is_economic, is_physical, "
                    "refund_amount, created_at, updated_at) VALUES "
                    "(:return_id, :line_id, :product_id, :package_id, 'UD', 1, :quantity, "
                    ":quantity, :economic, :physical, :amount, now(), now())"
                ),
                {
                    "return_id": return_id,
                    "line_id": line_id,
                    "product_id": product_id,
                    "package_id": package_id,
                    "quantity": quantity,
                    "economic": economic,
                    "physical": physical,
                    "amount": quantity * 10 if economic else 0,
                },
            )

    # The fourth boolean combination never represented a valid return. The
    # migration must stop for explicit reconciliation instead of inventing
    # whether the old quantity meant money or merchandise.
    with pytest.raises(RuntimeError, match="neither an economic nor physical effect"):
        run_alembic(url, "upgrade", "6a4d2f8c1b73")
    with engine.begin() as connection:
        untouched = connection.execute(
            text(
                "SELECT quantity_base, is_economic, is_physical FROM return_lines "
                "WHERE sale_line_id = :line_id"
            ),
            {"line_id": line_ids[3]},
        ).one()
        assert untouched == (1, False, False)
        # This is the explicit business reconciliation an operator would make.
        connection.execute(
            text(
                "UPDATE return_lines SET is_economic = true, refund_amount = 10 "
                "WHERE sale_line_id = :line_id"
            ),
            {"line_id": line_ids[3]},
        )

    run_alembic(url, "upgrade", "6a4d2f8c1b73")
    with engine.begin() as connection:
        counters = connection.execute(
            text(
                "SELECT quantity_refunded, quantity_physically_returned FROM sale_lines "
                "WHERE id = ANY(:ids) ORDER BY id"
            ),
            {"ids": line_ids},
        ).all()
        quantities = connection.execute(
            text(
                "SELECT refund_quantity_base, stock_return_quantity_base FROM return_lines "
                "ORDER BY id"
            )
        ).all()
        refunds = connection.execute(
            text("SELECT amount, method, status FROM refunds ORDER BY return_id")
        ).all()
    assert counters == [(2, 0), (0, 3), (4, 4), (1, 0)]
    assert quantities == [(2, 0), (0, 3), (4, 4), (1, 0)]
    assert refunds == [
        (20, None, "COMPLETED"),
        (40, None, "COMPLETED"),
        (10, None, "COMPLETED"),
    ]

    run_alembic(url, "downgrade", "3e7b1c9d5a42")
    with engine.begin() as connection:
        restored = connection.execute(
            text("SELECT quantity_base, is_economic, is_physical FROM return_lines ORDER BY id")
        ).all()
    assert restored == [
        (2, True, False),
        (3, False, True),
        (4, True, True),
        (1, True, False),
    ]
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
