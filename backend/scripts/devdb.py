"""Database bootstrap helper for development and CI.

``psql``/``createdb`` are not always available (the userland PostgreSQL build
used by ``scripts/dev-postgres.sh`` ships only the server binaries), so the
create/drop/wait plumbing lives here and goes through psycopg.

Usage::

    uv run python -m scripts.devdb wait
    uv run python -m scripts.devdb create
    uv run python -m scripts.devdb reset      # drop + create
    uv run python -m scripts.devdb create --database openerp_test
"""

from __future__ import annotations

import argparse
import sys
import time
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql

from app.core.config import get_settings


def _libpq_url(url: str, database: str) -> str:
    """Rewrite a SQLAlchemy URL into a plain libpq URL for ``database``."""
    parts = urlsplit(url)
    scheme = parts.scheme.split("+", 1)[0]
    return urlunsplit((scheme, parts.netloc, f"/{database}", "", ""))


def _target_database(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


def wait_for_server(url: str, *, timeout: float = 30.0) -> None:
    """Block until the server accepts connections on the maintenance database."""
    deadline = time.monotonic() + timeout
    admin_url = _libpq_url(url, "postgres")
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with psycopg.connect(admin_url, connect_timeout=3):
                return
        except psycopg.OperationalError as exc:  # server not up yet
            last_error = exc
            time.sleep(0.5)
    raise TimeoutError(f"PostgreSQL not reachable within {timeout}s: {last_error}")


def create_database(url: str, database: str) -> bool:
    """Create ``database`` if missing.  Returns True when it was created."""
    with psycopg.connect(_libpq_url(url, "postgres"), autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (database,)
        ).fetchone()
        if exists:
            return False
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        return True


def drop_database(url: str, database: str) -> bool:
    """Drop ``database`` if present, terminating other backends first."""
    with psycopg.connect(_libpq_url(url, "postgres"), autocommit=True) as conn:
        conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = %s AND pid <> pg_backend_pid()",
            (database,),
        )
        conn.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(database)))
        return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["wait", "create", "drop", "reset"])
    parser.add_argument(
        "--database",
        help="Database name (defaults to the one in OPENERP_DATABASE_URL).",
    )
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args(argv)

    url = get_settings().database_url
    database = args.database or _target_database(url)

    if args.command == "wait":
        wait_for_server(url, timeout=args.timeout)
        print(f"postgres is accepting connections ({urlsplit(url).netloc})")
        return 0

    wait_for_server(url, timeout=args.timeout)

    if args.command in ("drop", "reset"):
        drop_database(url, database)
        print(f"dropped database {database!r}")
    if args.command in ("create", "reset"):
        created = create_database(url, database)
        print(f"{'created' if created else 'already present'}: database {database!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
