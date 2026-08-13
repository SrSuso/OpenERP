"""Real PostgreSQL backup, isolated restore and operational upgrade drills."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import uuid
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

from scripts.devdb import drop_database
from tests.conftest import BACKEND_ROOT, run_alembic

pytestmark = pytest.mark.skipif(
    any(shutil.which(tool) is None for tool in ("pg_dump", "pg_restore", "psql")),
    reason="PostgreSQL client tools are not installed",
)

SCRIPTS_DIR = BACKEND_ROOT.parent / "scripts"


def _run(
    *args: str,
    env: dict[str, str] | None = None,
    expected_returncode: int = 0,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=120, check=False)
    assert result.returncode == expected_returncode, (
        f"{args}\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )
    return result


def _with_database(url: str, database: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, ""))


def _database_name(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


def _row_count(url: str, table: str) -> int:
    with psycopg.connect(url) as conn:
        row = conn.execute(f"select count(*) from {table}").fetchone()
        assert row is not None
        return int(row[0])


def _seed_representative_data(url: str, marker: str) -> dict[str, str]:
    email = f"{marker}@example.com"
    sku = f"{marker}-SKU"
    notes = f"{marker}-sale"
    with psycopg.connect(url) as conn:
        role_row = conn.execute("select id from roles where name = 'ADMIN'").fetchone()
        location_row = conn.execute(
            "select w.id, l.id from warehouses w join locations l on l.warehouse_id = w.id "
            "order by w.id, l.id limit 1"
        ).fetchone()
        assert role_row is not None and location_row is not None
        role_id = role_row[0]
        warehouse_id, location_id = location_row
        conn.execute(
            "insert into users (email, full_name, password_hash, role_id) values (%s, %s, %s, %s)",
            (email, f"Restore {marker}", "not-a-real-login-hash", role_id),
        )
        conn.execute(
            "insert into products "
            "(sku, name, description, base_unit_name, cost, list_price, tax_rate, min_stock) "
            "values (%s, %s, '', 'UNIT', 1, 2, 21, 0)",
            (sku, f"Restore product {marker}"),
        )
        conn.execute(
            "insert into sales (warehouse_id, location_id, status, notes) "
            "values (%s, %s, 'DRAFT', %s)",
            (warehouse_id, location_id, notes),
        )
    return {"email": email, "sku": sku, "notes": notes}


def _backup(source_url: str, dump_dir: Path, *, release: str = "test-release") -> Path:
    env = {
        **os.environ,
        "OPENERP_DATABASE_URL": source_url,
        "OPENERP_BACKUP_RELEASE": release,
    }
    _run(str(SCRIPTS_DIR / "backup-postgres.sh"), str(dump_dir), env=env)
    dumps = list(dump_dir.glob("*.dump"))
    assert len(dumps) == 1
    return dumps[0]


def _production_backup_from_url_file(source_url: str, dump_dir: Path, tmp_path: Path) -> Path:
    secret = tmp_path / "database-url.secret"
    env_file = tmp_path / ".env.production"
    secret.write_text(f"{source_url}\n")
    secret.chmod(0o600)
    env_file.write_text(f"OPENERP_DATABASE_URL_FILE={secret}\nOPENERP_BACKUP_KEEP_COUNT=14\n")
    env = {
        **os.environ,
        "OPENERP_PRODUCTION_ENV_FILE": str(env_file),
        "OPENERP_BACKUP_RELEASE": "test-release",
    }
    _run(str(SCRIPTS_DIR / "production-database.sh"), "backup", str(dump_dir), env=env)
    dumps = list(dump_dir.glob("*.dump"))
    assert len(dumps) == 1
    return dumps[0]


def _restore(source_url: str, dump: Path, target_database: str) -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "OPENERP_DATABASE_URL": source_url,
        "OPENERP_RESTORE_LOCK_FILE": str(dump.parent / "restore.lock"),
    }
    return _run(
        str(SCRIPTS_DIR / "restore-postgres.sh"),
        str(dump),
        "--target-database",
        target_database,
        env=env,
    )


def test_backup_then_restore_reproduces_user_product_sale_and_revision(
    fresh_database: Callable[[], str], postgres_server_url: str, tmp_path: Path
) -> None:
    source_url = fresh_database()
    run_alembic(source_url, "upgrade", "head")
    marker = f"backup-{uuid.uuid4().hex[:8]}"
    sentinel = _seed_representative_data(source_url, marker)
    expected_counts = {
        table: _row_count(source_url, table) for table in ("users", "products", "sales")
    }
    expected_revision = run_alembic(source_url, "current").strip()

    dump_dir = tmp_path / "backups"
    dump = _production_backup_from_url_file(source_url, dump_dir, tmp_path)
    target_database = f"openerp_restore_{uuid.uuid4().hex[:12]}"
    target_url = _with_database(postgres_server_url, target_database)
    try:
        result = _restore(source_url, dump, target_database)

        assert "verified restore" in result.stdout
        restored_counts = {table: _row_count(target_url, table) for table in expected_counts}
        assert restored_counts == expected_counts
        assert run_alembic(target_url, "current").strip() == expected_revision
        with psycopg.connect(target_url) as conn:
            assert conn.execute(
                "select email from users where email = %s", (sentinel["email"],)
            ).fetchone() == (sentinel["email"],)
            assert conn.execute(
                "select sku from products where sku = %s", (sentinel["sku"],)
            ).fetchone() == (sentinel["sku"],)
            assert conn.execute(
                "select notes from sales where notes = %s", (sentinel["notes"],)
            ).fetchone() == (sentinel["notes"],)
    finally:
        drop_database(postgres_server_url, target_database)

    assert stat.S_IMODE(dump_dir.stat().st_mode) == 0o700
    for protected in (dump, Path(f"{dump}.sha256"), Path(f"{dump}.metadata")):
        assert stat.S_IMODE(protected.stat().st_mode) == 0o600
    metadata = Path(f"{dump}.metadata").read_text()
    assert "database=" in metadata
    assert "release=test-release" in metadata
    assert "alembic_revision=" in metadata
    assert "sha256=" in metadata


def test_restore_rejects_live_database_and_tampered_dump_before_creating_target(
    fresh_database: Callable[[], str], postgres_server_url: str, tmp_path: Path
) -> None:
    source_url = fresh_database()
    run_alembic(source_url, "upgrade", "head")
    dump = _backup(source_url, tmp_path / "backups")
    env = {
        **os.environ,
        "OPENERP_DATABASE_URL": source_url,
        "OPENERP_RESTORE_LOCK_FILE": str(tmp_path / "restore.lock"),
    }

    live = subprocess.run(
        [
            str(SCRIPTS_DIR / "restore-postgres.sh"),
            str(dump),
            "--target-database",
            _database_name(source_url),
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert live.returncode != 0
    assert "refusing to restore over the configured live database" in live.stderr

    occupied_url = fresh_database()
    occupied_database = _database_name(occupied_url)
    with psycopg.connect(occupied_url) as occupied_connection:
        occupied = subprocess.run(
            [
                str(SCRIPTS_DIR / "restore-postgres.sh"),
                str(dump),
                "--target-database",
                occupied_database,
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert occupied.returncode != 0
        assert "already exists" in occupied.stderr
        assert occupied_connection.execute("select 1").fetchone() == (1,)

    with dump.open("ab") as stream:
        stream.write(b"tampered")
    target_database = f"openerp_restore_{uuid.uuid4().hex[:12]}"
    tampered = subprocess.run(
        [
            str(SCRIPTS_DIR / "restore-postgres.sh"),
            str(dump),
            "--target-database",
            target_database,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert tampered.returncode != 0
    assert "checksum does not match" in tampered.stderr
    with psycopg.connect(postgres_server_url) as conn:
        assert (
            conn.execute(
                "select 1 from pg_database where datname = %s", (target_database,)
            ).fetchone()
            is None
        )


def test_operational_upgrade_from_previous_revision_preserves_known_data_and_has_backup(
    fresh_database: Callable[[], str], tmp_path: Path
) -> None:
    source_url = fresh_database()
    previous_revision = "e4a7c2d91b65"
    run_alembic(source_url, "upgrade", previous_revision)
    marker = f"upgrade-{uuid.uuid4().hex[:8]}"
    sentinel = _seed_representative_data(source_url, marker)

    dump = _backup(source_url, tmp_path / "pre-upgrade", release="previous-release")
    run_alembic(source_url, "upgrade", "head")

    assert dump.is_file() and dump.stat().st_size > 0
    assert "(head)" in run_alembic(source_url, "current")
    with psycopg.connect(source_url) as conn:
        assert conn.execute(
            "select 1 from users where email = %s", (sentinel["email"],)
        ).fetchone() == (1,)
        assert conn.execute(
            "select 1 from products where sku = %s", (sentinel["sku"],)
        ).fetchone() == (1,)
        assert conn.execute(
            "select 1 from sales where notes = %s", (sentinel["notes"],)
        ).fetchone() == (1,)


def test_backup_requires_a_source_url(tmp_path: Path) -> None:
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {
            "OPENERP_DATABASE_URL",
            "OPENERP_DATABASE_URL_FILE",
            "OPENERP_BACKUP_SOURCE_URL",
            "OPENERP_BACKUP_SOURCE_URL_FILE",
        }
    }
    result = subprocess.run(
        [str(SCRIPTS_DIR / "backup-postgres.sh"), str(tmp_path)],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode != 0
