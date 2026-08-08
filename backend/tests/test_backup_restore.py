"""Phase 21: backup/restore, round-tripped for real.

Runs the actual shell scripts (``scripts/backup-postgres.sh``,
``scripts/restore-postgres.sh``) as subprocesses against two real,
throwaway PostgreSQL databases (``fresh_database``) — the same "never
mock the database" stance the rest of this suite takes, extended to the
disaster-recovery path itself: a backup script that has never actually
produced a restorable dump is worth nothing.

Skipped when the PostgreSQL client tools (``pg_dump``/``pg_restore``) are
not on ``PATH`` — a separate package from the server, not guaranteed to be
installed everywhere this suite runs (see the scripts' own docstrings).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from collections.abc import Callable
from pathlib import Path

import psycopg
import pytest

from tests.conftest import BACKEND_ROOT, run_alembic

pytestmark = pytest.mark.skipif(
    shutil.which("pg_dump") is None or shutil.which("pg_restore") is None,
    reason="postgresql-client (pg_dump/pg_restore) not installed",
)

SCRIPTS_DIR = BACKEND_ROOT.parent / "scripts"


def _run(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=60, check=False)
    assert result.returncode == 0, f"{args}\nstdout: {result.stdout}\nstderr: {result.stderr}"
    return result


def _row_count(url: str, table: str) -> int:
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        # Fixed, hardcoded table names from this file's own call sites only —
        # never attacker input — so an f-string here isn't a SQL injection risk.
        cur.execute(f"select count(*) from {table}")
        row = cur.fetchone()
        assert row is not None
        return int(row[0])


def test_backup_then_restore_reproduces_the_data(
    fresh_database: Callable[[], str], tmp_path: Path
) -> None:
    source_url = fresh_database()
    run_alembic(source_url, "upgrade", "head")

    # A row that exists only because *this* database was seeded, on top of
    # whatever the migration itself seeds — proves the restore round-trips
    # real application data, not just schema + migration-time seed rows.
    marker = f"backup-test-{uuid.uuid4().hex[:8]}"
    with psycopg.connect(source_url) as conn, conn.cursor() as cur:
        cur.execute("insert into warehouses (name) values (%s)", (marker,))
        conn.commit()

    permissions_before = _row_count(source_url, "permissions")
    warehouses_before = _row_count(source_url, "warehouses")

    dump_dir = tmp_path / "backups"
    env = {**os.environ, "OPENERP_DATABASE_URL": source_url}
    _run(str(SCRIPTS_DIR / "backup-postgres.sh"), str(dump_dir), env=env)

    dump_files = list(dump_dir.glob("*.dump"))
    assert len(dump_files) == 1, f"expected exactly one .dump file, found {dump_files}"

    # An empty, unmigrated database — the dump itself carries the full
    # schema (tables, indexes, constraints), so pg_restore has to recreate
    # everything from nothing, same as a real disaster-recovery target.
    target_url = fresh_database()

    _run(str(SCRIPTS_DIR / "restore-postgres.sh"), str(dump_files[0]), target_url, "--yes")

    assert _row_count(target_url, "permissions") == permissions_before
    assert _row_count(target_url, "warehouses") == warehouses_before
    with psycopg.connect(target_url) as conn, conn.cursor() as cur:
        cur.execute("select 1 from warehouses where name = %s", (marker,))
        assert cur.fetchone() is not None, "the seeded warehouse row did not survive the round trip"


def test_restore_without_yes_or_confirmation_is_refused(
    fresh_database: Callable[[], str], tmp_path: Path
) -> None:
    """No ``--yes`` and no stdin to answer the prompt with — must abort
    rather than hang or, worse, proceed."""
    source_url = fresh_database()
    run_alembic(source_url, "upgrade", "head")

    dump_dir = tmp_path / "backups"
    env = {**os.environ, "OPENERP_DATABASE_URL": source_url}
    _run(str(SCRIPTS_DIR / "backup-postgres.sh"), str(dump_dir), env=env)
    dump_file = next(dump_dir.glob("*.dump"))

    target_url = fresh_database()
    result = subprocess.run(
        [str(SCRIPTS_DIR / "restore-postgres.sh"), str(dump_file), target_url],
        input="",  # closed stdin: `read` fails immediately instead of blocking
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode != 0


def test_backup_requires_a_source_url(tmp_path: Path) -> None:
    env = {k: v for k, v in os.environ.items() if k != "OPENERP_DATABASE_URL"}
    env.pop("OPENERP_BACKUP_SOURCE_URL", None)
    result = subprocess.run(
        [str(SCRIPTS_DIR / "backup-postgres.sh"), str(tmp_path)],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode != 0
