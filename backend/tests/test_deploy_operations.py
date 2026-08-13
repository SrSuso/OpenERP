"""Deterministic tests for the production deployment shell workflow."""

from __future__ import annotations

import fcntl
import os
import shutil
import subprocess
from pathlib import Path

from tests.conftest import BACKEND_ROOT

PROJECT_ROOT = BACKEND_ROOT.parent
DEPLOY_SCRIPT = BACKEND_ROOT.parent / "scripts" / "deploy-update.sh"
PRUNE_SCRIPT = BACKEND_ROOT.parent / "scripts" / "prune-postgres-backups.sh"


def _write_executable(path: Path, source: str) -> None:
    path.write_text(source)
    path.chmod(0o700)


def _deploy_fixture(tmp_path: Path) -> tuple[Path, Path, Path, dict[str, str]]:
    root = tmp_path / "checkout"
    scripts = root / "scripts"
    fake_bin = tmp_path / "bin"
    scripts.mkdir(parents=True)
    fake_bin.mkdir()
    (root / ".git").mkdir()
    (root / ".env.production").write_text("POSTGRES_DB=openerp\n")
    shutil.copy2(DEPLOY_SCRIPT, scripts / "deploy-update.sh")

    command_log = tmp_path / "commands.log"
    _write_executable(
        fake_bin / "git",
        """#!/bin/sh
case "$*" in
  "status --porcelain") exit 0 ;;
  "rev-parse --abbrev-ref HEAD") printf '%s\\n' main ;;
  "rev-parse HEAD")
    if [ -e "$OPENERP_TEST_GIT_STATE" ]; then
      printf '%s\\n' 2222222222222222222222222222222222222222
    else
      : > "$OPENERP_TEST_GIT_STATE"
      printf '%s\\n' 1111111111111111111111111111111111111111
    fi
    ;;
  "pull --ff-only") exit 0 ;;
  *) exit 0 ;;
esac
""",
    )
    _write_executable(
        fake_bin / "make",
        """#!/bin/sh
printf '%s\\n' "$*" >> "$OPENERP_TEST_COMMAND_LOG"
if [ "$1" = "prod-backup" ]; then
  : > "$OPENERP_TEST_BACKUP_FILE"
  if [ -n "${OPENERP_BACKUP_RESULT_FILE:-}" ]; then
    printf '%s\\n' "$OPENERP_TEST_BACKUP_FILE" > "$OPENERP_BACKUP_RESULT_FILE"
  fi
fi
if [ "${OPENERP_TEST_FAIL_TARGET:-}" = "$1" ]; then
  exit 42
fi
exit 0
""",
    )
    env = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "OPENERP_TEST_COMMAND_LOG": str(command_log),
        "OPENERP_TEST_BACKUP_FILE": str(tmp_path / "verified.dump"),
        "OPENERP_TEST_GIT_STATE": str(tmp_path / "git-state"),
        "OPENERP_DEPLOY_LOCK_FILE": str(tmp_path / "deploy.lock"),
    }
    return root, scripts / "deploy-update.sh", command_log, env


def _run_deploy(script: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(script), "--force"],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_deploy_stops_all_writers_before_backup_and_migration(tmp_path: Path) -> None:
    root, script, command_log, env = _deploy_fixture(tmp_path)

    result = _run_deploy(script, env)

    assert result.returncode == 0, result.stderr
    commands = command_log.read_text().splitlines()
    assert commands.index("prod-preflight") < commands.index("prod-preserve-current-images")
    assert commands.index("prod-preserve-current-images") < commands.index("prod-build")
    assert commands.index("prod-build") < commands.index("prod-start-maintenance-web")
    assert commands.index("prod-start-maintenance-web") < commands.index("prod-stop-writers")
    assert commands.index("prod-stop-writers") < commands.index("prod-backup")
    assert commands.index("prod-backup") < commands.index("prod-migrate")
    assert commands.index("prod-migration-check") < commands.index("prod-start-api-web")
    assert commands.index("prod-smoke") < commands.index("prod-start-worker")
    assert not (root / "deploy" / "maintenance" / "enabled").exists()
    assert (root / "deploy" / "state" / "previous-version").read_text().strip() == "1" * 40
    assert (root / "deploy" / "state" / "current-version").read_text().strip() == "2" * 40


def test_backup_failure_never_migrates_or_starts_target_version(tmp_path: Path) -> None:
    root, script, command_log, env = _deploy_fixture(tmp_path)
    env["OPENERP_TEST_FAIL_TARGET"] = "prod-backup"

    result = _run_deploy(script, env)

    assert result.returncode != 0
    commands = command_log.read_text().splitlines()
    assert "prod-migrate" not in commands
    assert "prod-start-api-web" not in commands
    assert (root / "deploy" / "maintenance" / "enabled").is_file()
    assert "maintenance remains ON" in result.stderr


def test_migration_failure_keeps_backup_and_all_writers_stopped(tmp_path: Path) -> None:
    root, script, command_log, env = _deploy_fixture(tmp_path)
    env["OPENERP_TEST_FAIL_TARGET"] = "prod-migrate"

    result = _run_deploy(script, env)

    assert result.returncode != 0
    commands = command_log.read_text().splitlines()
    assert "prod-backup" in commands
    assert Path(env["OPENERP_TEST_BACKUP_FILE"]).is_file()
    assert "prod-start-api-web" not in commands
    assert commands[-1] == "prod-stop-writers"
    assert (root / "deploy" / "maintenance" / "enabled").is_file()


def test_smoke_failure_returns_to_stopped_writers_and_keeps_maintenance(tmp_path: Path) -> None:
    root, script, command_log, env = _deploy_fixture(tmp_path)
    env["OPENERP_TEST_FAIL_TARGET"] = "prod-smoke"

    result = _run_deploy(script, env)

    assert result.returncode != 0
    commands = command_log.read_text().splitlines()
    assert "prod-start-api-web" in commands
    assert "prod-start-worker" not in commands
    assert commands[-1] == "prod-stop-writers"
    assert (root / "deploy" / "maintenance" / "enabled").is_file()
    assert "isolated-database rollback" in result.stderr


def test_deploy_lock_rejects_a_second_process(tmp_path: Path) -> None:
    _root, script, command_log, env = _deploy_fixture(tmp_path)
    lock_path = Path(env["OPENERP_DEPLOY_LOCK_FILE"])
    lock_path.touch()

    with lock_path.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = _run_deploy(script, env)

    assert result.returncode != 0
    assert "already running" in result.stderr
    assert not command_log.exists()


def test_backup_retention_keeps_newest_files_and_never_follows_symlinks(tmp_path: Path) -> None:
    backup_dir = tmp_path / "backups"
    outside = tmp_path / "outside.dump"
    backup_dir.mkdir()
    outside.write_text("outside")
    names = [
        "openerp_shop_20260810T000000Z_a.dump",
        "openerp_shop_20260811T000000Z_b.dump",
        "openerp_shop_20260812T000000Z_c.dump",
        "openerp_shop_20260813T000000Z_d.dump",
    ]
    for name in names:
        dump = backup_dir / name
        dump.write_text(name)
        Path(f"{dump}.sha256").write_text("checksum")
        Path(f"{dump}.metadata").write_text("metadata")
    symlink = backup_dir / "openerp_shop_20260899T000000Z_symlink.dump"
    symlink.symlink_to(outside)

    result = subprocess.run(
        [str(PRUNE_SCRIPT), str(backup_dir), "2", str(backup_dir / names[-1])],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    retained = sorted(path.name for path in backup_dir.glob("*.dump") if not path.is_symlink())
    assert retained == names[-2:]
    assert symlink.is_symlink()
    assert outside.read_text() == "outside"
    for name in names[:-2]:
        assert not Path(f"{backup_dir / name}.sha256").exists()
        assert not Path(f"{backup_dir / name}.metadata").exists()


def test_manual_production_migrate_and_up_also_require_stopped_writers() -> None:
    for target, operation in (("prod-migrate", "run --rm migrate"), ("prod-up", "up -d --wait")):
        result = subprocess.run(
            ["make", "-n", target],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.index("docker inspect") < result.stdout.index(operation)
