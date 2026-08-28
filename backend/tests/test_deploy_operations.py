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
SCHEMA_CHECK_SCRIPT = (
    BACKEND_ROOT.parent / "scripts" / "check-production-migration-compatibility.sh"
)
PRODUCTION_DATABASE_SCRIPT = BACKEND_ROOT.parent / "scripts" / "production-database.sh"
POSTGRES_HELPERS_SCRIPT = BACKEND_ROOT.parent / "scripts" / "lib-postgres.sh"
PRESERVE_IMAGES_SCRIPT = BACKEND_ROOT.parent / "scripts" / "preserve-production-images.sh"
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


def _run_deploy(script: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(script), *args, "--force"],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def _run_schema_check(
    tmp_path: Path, *, database_revision: str, branch_revisions: list[str]
) -> subprocess.CompletedProcess[str]:
    root = tmp_path / "checkout"
    scripts = root / "scripts"
    versions = root / "backend" / "migrations" / "versions"
    fake_bin = tmp_path / "bin"
    scripts.mkdir(parents=True)
    versions.mkdir(parents=True)
    fake_bin.mkdir()
    (root / ".git").mkdir()
    shutil.copy2(SCHEMA_CHECK_SCRIPT, scripts / SCHEMA_CHECK_SCRIPT.name)
    _write_executable(
        scripts / "production-database.sh",
        f"#!/bin/sh\nprintf '%s\\n' '{database_revision}'\n",
    )
    _write_executable(fake_bin / "git", "#!/bin/sh\nprintf '%s\\n' main\n")
    for position, revision in enumerate(branch_revisions):
        (versions / f"{position:04d}-{revision}.py").write_text(
            f'revision: str = "{revision}"\n', encoding="utf-8"
        )

    return subprocess.run(
        [str(scripts / SCHEMA_CHECK_SCRIPT.name)],
        cwd=root,
        env={**os.environ, "PATH": f"{fake_bin}:{os.environ['PATH']}"},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_schema_check_accepts_a_revision_known_by_the_target_branch(tmp_path: Path) -> None:
    result = _run_schema_check(
        tmp_path, database_revision="e8b3c7d5a2f1", branch_revisions=["e8b3c7d5a2f1"]
    )

    assert result.returncode == 0, result.stderr
    assert "revision is present in branch main" in result.stdout


def test_schema_check_rejects_a_feature_revision_missing_from_stable(tmp_path: Path) -> None:
    result = _run_schema_check(
        tmp_path, database_revision="c6a2e9f4b1d7", branch_revisions=["e8b3c7d5a2f1"]
    )

    assert result.returncode != 0
    assert "c6a2e9f4b1d7 is not present in target branch main" in result.stderr
    assert "Do not edit alembic_version" in result.stderr


def test_current_revision_reads_postgres_without_exposing_its_password(tmp_path: Path) -> None:
    root = tmp_path / "checkout"
    scripts = root / "scripts"
    fake_bin = tmp_path / "bin"
    scripts.mkdir(parents=True)
    fake_bin.mkdir()
    shutil.copy2(PRODUCTION_DATABASE_SCRIPT, scripts / PRODUCTION_DATABASE_SCRIPT.name)
    shutil.copy2(POSTGRES_HELPERS_SCRIPT, scripts / POSTGRES_HELPERS_SCRIPT.name)
    (root / ".env.production").write_text(
        "OPENERP_DATABASE_URL=postgresql+psycopg://openerp:supersecret@postgres:5432/openerp\n",
        encoding="utf-8",
    )
    psql_log = tmp_path / "psql.log"
    _write_executable(
        fake_bin / "psql",
        "#!/bin/sh\n"
        'printf \'%s\\n\' "$*" >> "$OPENERP_TEST_PSQL_LOG"\n'
        'case "$*" in\n'
        "  *to_regclass*) printf '%s\\n' alembic_version ;;\n"
        "  *) printf '%s\\n' c6a2e9f4b1d7 ;;\n"
        "esac\n",
    )

    result = subprocess.run(
        [str(scripts / PRODUCTION_DATABASE_SCRIPT.name), "current-revision"],
        cwd=root,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "OPENERP_TEST_PSQL_LOG": str(psql_log),
        },
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "c6a2e9f4b1d7"
    assert "supersecret" not in result.stdout
    assert "supersecret" not in result.stderr
    assert "supersecret" not in psql_log.read_text()
    assert "openerp@127.0.0.1:5432/openerp" in psql_log.read_text()


def test_preserve_images_uses_immutable_config_reference_when_compose_digest_is_missing(
    tmp_path: Path,
) -> None:
    root = tmp_path / "checkout"
    scripts = root / "scripts"
    fake_bin = tmp_path / "bin"
    scripts.mkdir(parents=True)
    fake_bin.mkdir()
    shutil.copy2(PRESERVE_IMAGES_SCRIPT, scripts / "preserve-production-images.sh")
    tag_log = tmp_path / "tags.log"
    version = "a" * 40

    _write_executable(
        fake_bin / "docker",
        f"""#!/bin/sh
case "$1" in
  compose)
    for arg in "$@"; do service="$arg"; done
    printf '%s-container\\n' "$service"
    ;;
  inspect)
    case "$4:$3" in
      api-container:{{{{.Image}}}}) printf '%s\\n' sha256:api-config-digest ;;
      web-container:{{{{.Image}}}}) printf '%s\\n' sha256:web-config-digest ;;
      api-container:{{{{.Config.Image}}}}) printf '%s\\n' openerp-backend:{version} ;;
      web-container:{{{{.Config.Image}}}}) printf '%s\\n' openerp-frontend:{version} ;;
      *) exit 1 ;;
    esac
    ;;
  image)
    case "$2:$3" in
      inspect:openerp-backend:{version}|inspect:openerp-frontend:{version}) exit 0 ;;
      inspect:*) exit 1 ;;
      tag:openerp-backend:{version}|tag:openerp-frontend:{version})
        printf '%s -> %s\\n' "$3" "$4" >> "$OPENERP_TEST_TAG_LOG"
        ;;
      *) exit 1 ;;
    esac
    ;;
  *) exit 1 ;;
esac
""",
    )

    result = subprocess.run(
        [str(scripts / "preserve-production-images.sh"), version],
        cwd=root,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "OPENERP_TEST_TAG_LOG": str(tag_log),
        },
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert tag_log.read_text().splitlines() == [
        f"openerp-backend:{version} -> openerp-backend:{version}",
        f"openerp-frontend:{version} -> openerp-frontend:{version}",
    ]


def test_deploy_stops_all_writers_before_backup_and_migration(tmp_path: Path) -> None:
    root, script, command_log, env = _deploy_fixture(tmp_path)

    result = _run_deploy(script, env)

    assert result.returncode == 0, result.stderr
    commands = command_log.read_text().splitlines()
    assert commands.index("prod-preflight") < commands.index("prod-preserve-current-images")
    assert commands.index("prod-preserve-current-images") < commands.index("prod-build")
    assert commands.index("prod-build") < commands.index("prod-start-maintenance-web")
    assert commands.index("prod-validate-api-config") < commands.index("prod-start-maintenance-web")
    assert commands.index("prod-schema-compatible") < commands.index("prod-start-maintenance-web")
    assert commands.index("prod-start-maintenance-web") < commands.index("prod-stop-writers")
    assert commands.index("prod-stop-writers") < commands.index("prod-backup")
    assert commands.index("prod-backup") < commands.index("prod-migrate")
    assert commands.index("prod-migration-check") < commands.index("prod-start-api-web")
    assert commands.index("prod-smoke") < commands.index("prod-start-worker")
    assert not (root / "deploy" / "maintenance" / "enabled").exists()
    assert (root / "deploy" / "state" / "previous-version").read_text().strip() == "1" * 40
    assert (root / "deploy" / "state" / "current-version").read_text().strip() == "2" * 40


def test_deploy_can_select_a_remote_branch_before_updating(tmp_path: Path) -> None:
    _root, script, _command_log, env = _deploy_fixture(tmp_path)
    git_log = tmp_path / "git-commands.log"
    fake_git = Path(env["PATH"].split(":", maxsplit=1)[0]) / "git"
    fake_git.write_text(
        "#!/bin/sh\n"
        'printf \'%s\\n\' "$*" >> "$OPENERP_TEST_GIT_COMMAND_LOG"\n'
        'case "$*" in\n'
        "  'status --porcelain') exit 0 ;;\n"
        "  'rev-parse --abbrev-ref HEAD') printf '%s\\n' main ;;\n"
        "  'rev-parse HEAD')\n"
        '    if [ -e "$OPENERP_TEST_GIT_STATE" ]; then\n'
        "      printf '%s\\n' 2222222222222222222222222222222222222222\n"
        "    else\n"
        '      : > "$OPENERP_TEST_GIT_STATE"\n'
        "      printf '%s\\n' 1111111111111111111111111111111111111111\n"
        "    fi ;;\n"
        "  *) exit 0 ;;\n"
        "esac\n"
    )
    fake_git.chmod(0o700)
    env["OPENERP_TEST_GIT_COMMAND_LOG"] = str(git_log)

    result = _run_deploy(script, env, "--branch", "v2")

    assert result.returncode == 0, result.stderr
    assert git_log.read_text().splitlines() == [
        "status --porcelain",
        "rev-parse --abbrev-ref HEAD",
        "check-ref-format --branch v2",
        "fetch --quiet origin refs/heads/v2:refs/remotes/origin/v2",
        "show-ref --verify --quiet refs/heads/v2",
        "switch v2",
        "rev-parse HEAD",
        "pull --ff-only origin v2",
        "rev-parse HEAD",
    ]


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


def test_incompatible_schema_never_enters_maintenance(tmp_path: Path) -> None:
    root, script, command_log, env = _deploy_fixture(tmp_path)
    env["OPENERP_TEST_FAIL_TARGET"] = "prod-schema-compatible"

    result = _run_deploy(script, env)

    assert result.returncode != 0
    commands = command_log.read_text().splitlines()
    assert "prod-schema-compatible" in commands
    assert "prod-start-maintenance-web" not in commands
    assert "prod-stop-writers" not in commands
    assert "prod-backup" not in commands
    assert "prod-migrate" not in commands
    assert not (root / "deploy" / "maintenance" / "enabled").exists()


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
