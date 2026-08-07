"""Test harness.

Tests run against a **real PostgreSQL** server — never SQLite, because the
system depends on PostgreSQL semantics (``NUMERIC``, row locking, ``FOR UPDATE
SKIP LOCKED``, advisory locks) that no other engine reproduces.

The server is resolved in this order:

1. ``OPENERP_TEST_DATABASE_URL`` — an already-running server (Docker Compose,
   CI service container, or the userland cluster from
   ``scripts/dev-postgres.sh``).
2. Testcontainers, when a working Docker daemon is present.
3. Otherwise the run fails with instructions.  It does not silently degrade.

A throwaway database is created per session and migrated with the real
``alembic upgrade head`` command, so the migration chain is exercised on every
test run.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.db.session import create_engine, get_session
from app.main import create_app
from scripts.devdb import create_database, drop_database, wait_for_server

BACKEND_ROOT = Path(__file__).resolve().parents[1]

_STARTUP_HELP = """
No PostgreSQL server available for the test suite.

Start one of these, then re-run:

  docker compose -f ../docker/compose.yml up -d postgres
  # or, without Docker:
  ../scripts/dev-postgres.sh start

and export the connection URL:

  export OPENERP_TEST_DATABASE_URL=postgresql://openerp:openerp@127.0.0.1:5432/postgres

SQLite is not an acceptable substitute for this project.
""".strip()


def _docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        return (
            subprocess.run(
                ["docker", "info"], capture_output=True, timeout=15, check=False
            ).returncode
            == 0
        )
    except (OSError, subprocess.TimeoutExpired):
        return False


def _with_database(url: str, database: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", "", ""))


@pytest.fixture(scope="session")
def postgres_server_url() -> Iterator[str]:
    """A URL pointing at a running server (database part is a placeholder)."""
    if configured := os.environ.get("OPENERP_TEST_DATABASE_URL"):
        wait_for_server(configured, timeout=30)
        yield configured
        return

    if not _docker_available():
        pytest.fail(_STARTUP_HELP, pytrace=False)

    from testcontainers.postgres import PostgresContainer  # imported lazily

    with PostgresContainer("postgres:17-alpine", driver=None) as container:
        url = container.get_connection_url()
        wait_for_server(url, timeout=60)
        yield url


@pytest.fixture(scope="session")
def database_url(postgres_server_url: str) -> Iterator[str]:
    """A migrated, throwaway database, dropped when the session ends."""
    name = f"openerp_test_{uuid.uuid4().hex[:12]}"
    create_database(postgres_server_url, name)
    url = _with_database(postgres_server_url, name)
    try:
        run_alembic(url, "upgrade", "head")
        yield url
    finally:
        drop_database(postgres_server_url, name)


def run_alembic(url: str, *args: str) -> str:
    """Invoke the real Alembic CLI against ``url`` and return its stdout."""
    env = {**os.environ, "OPENERP_DATABASE_URL": url}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}")
    return result.stdout


@pytest.fixture(scope="session")
def alembic_runner(database_url: str):  # type: ignore[no-untyped-def]
    """Run arbitrary Alembic commands against the test database."""

    def run(*args: str) -> str:
        return run_alembic(database_url, *args)

    return run


@pytest.fixture
def fresh_database(postgres_server_url: str) -> Iterator[Callable[..., str]]:
    """An empty, unmigrated database for tests that need to mutate the schema.

    Keeps destructive schema tests (downgrade round-trips) away from the
    session database other tests are using.
    """
    created: list[str] = []

    def make() -> str:
        name = f"openerp_schema_{uuid.uuid4().hex[:12]}"
        create_database(postgres_server_url, name)
        created.append(name)
        return _with_database(postgres_server_url, name)

    try:
        yield make
    finally:
        for name in created:
            drop_database(postgres_server_url, name)


@pytest.fixture(scope="session")
def settings(database_url: str) -> Settings:
    return Settings(
        database_url=database_url,
        environment="test",
        log_format="console",
        log_level="WARNING",
        db_pool_size=5,
        db_max_overflow=10,
    )


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def engine(settings: Settings) -> AsyncIterator[AsyncEngine]:
    eng = create_engine(settings)
    try:
        yield eng
    finally:
        await eng.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def connection(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    """A connection wrapped in a transaction that is always rolled back.

    Gives each test a clean database without re-running migrations.
    """
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            yield conn
        finally:
            await transaction.rollback()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    """Session joined to the outer transaction: commits inside a test are
    nested savepoints and vanish on rollback."""
    maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    async with maker() as session:
        yield session


@pytest_asyncio.fixture(loop_scope="session")
async def committing_sessionmaker(
    engine: AsyncEngine,
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Sessions that really commit.

    Required by concurrency tests (two cashiers racing for the last unit),
    which need separate connections observing each other's committed work.
    Such tests are responsible for their own cleanup.
    """
    yield async_sessionmaker(bind=engine, expire_on_commit=False)


@pytest_asyncio.fixture(loop_scope="session")
async def client(settings: Settings, db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """HTTP client bound to the app, sharing the test's rolled-back session."""
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings

    async def _override_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_session] = _override_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http
    app.dependency_overrides.clear()
