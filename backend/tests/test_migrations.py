"""The migration chain is the only way the schema changes.

``alembic check`` is the important one: it fails as soon as a model is added
without a matching migration, which is the usual way a codebase and its
database drift apart.
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncConnection

from tests.conftest import run_alembic

AlembicRunner = Callable[..., str]


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


def test_a_formula_naming_margin_amount_is_cleaned_up(fresh_database: Callable[[], str]) -> None:
    """d1f83c60a97e. El margen en euros dejó de ser una variable de fórmula,
    así que una fórmula que lo nombre ya no se puede evaluar: el producto se
    queda sin poder recalcular su precio, con un 422 y sin explicación. Si
    alguien alcanzó a escribirlo mientras la ayuda lo listaba, la migración
    tiene que quitarlo.
    """
    url = fresh_database()
    run_alembic(url, "upgrade", "c9b41e7a02d5")

    # El driver va explícito: sin él SQLAlchemy busca psycopg2, que aquí no
    # está (el proyecto usa psycopg 3).
    engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO product_categories (name, is_active, price_formula, tracks_stock, "
                "created_at, updated_at) "
                "VALUES ('Con fórmula', true, 'cost * 2 + margin_amount', true, now(), now())"
            )
        )
        connection.execute(text("UPDATE pricing_settings SET formula = 'margin_amount + cost'"))

    run_alembic(url, "upgrade", "head")

    with engine.begin() as connection:
        category_formula = connection.scalar(
            text("SELECT price_formula FROM product_categories WHERE name = 'Con fórmula'")
        )
        store_formula = connection.scalar(text("SELECT formula FROM pricing_settings"))
    engine.dispose()

    # La categoría vuelve a heredar; el margen en euros se le sigue
    # aplicando igual, porque ahora se suma fuera de la fórmula.
    assert category_formula is None
    # La de la tienda no puede quedar vacía: vuelve a la de fábrica, que sí
    # se puede evaluar.
    assert store_formula is not None
    assert "margin_amount" not in store_formula
