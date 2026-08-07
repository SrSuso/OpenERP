"""The migration chain is the only way the schema changes.

``alembic check`` is the important one: it fails as soon as a model is added
without a matching migration, which is the usual way a codebase and its
database drift apart.
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import text
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
