"""Focused contracts for the production Docker runtime and process logging."""

from __future__ import annotations

import json
import os
import select
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, cast

import pytest

from app.core.config import Settings
from app.main import create_app
from tests.conftest import BACKEND_ROOT

PROJECT_ROOT = BACKEND_ROOT.parent
COMPOSE_FILE = PROJECT_ROOT / "docker" / "compose.prod.yml"
ENV_FILE = PROJECT_ROOT / ".env.production.example"
EXPECTED_SERVICES = {"postgres", "migrate", "api", "worker", "web"}
LOG_ROTATION = {"max-size": "10m", "max-file": "5"}


def _run(
    *args: str, check: bool = True, cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=60, check=check, cwd=cwd)


def _compose_config() -> dict[str, Any]:
    result = _run(
        "docker",
        "compose",
        "-f",
        str(COMPOSE_FILE),
        "--env-file",
        str(ENV_FILE),
        "config",
        "--no-env-resolution",
        "--format",
        "json",
    )
    return cast(dict[str, Any], json.loads(result.stdout))


def test_production_compose_has_bounded_logs_and_expected_runtime_limits() -> None:
    config = _compose_config()
    assert config["name"] == "openerp-prod"
    services = cast(dict[str, dict[str, Any]], config["services"])
    assert set(services) == EXPECTED_SERVICES
    assert "mailpit" not in services
    assert services["postgres"]["image"] == "postgres:17.10-alpine3.24"

    for service in services.values():
        assert service["logging"] == {"driver": "json-file", "options": LOG_ROTATION}

    expected_limits = {
        "migrate": (536_870_912, 1),
        "api": (536_870_912, 1),
        "worker": (268_435_456, 0.5),
        "web": (134_217_728, 0.5),
    }
    for name, (memory, cpus) in expected_limits.items():
        assert int(services[name]["mem_limit"]) == memory
        assert services[name]["cpus"] == cpus
    assert "mem_limit" not in services["postgres"]
    assert services["migrate"]["restart"] == "no"
    for name in ("postgres", "api", "worker", "web"):
        assert services[name]["restart"] == "unless-stopped"


def test_production_commands_refresh_bases_and_remove_only_project_orphans() -> None:
    build = _run("make", "-n", "prod-build", cwd=PROJECT_ROOT)
    clean_build = _run("make", "-n", "prod-build-clean", cwd=PROJECT_ROOT)
    assert "build --pull" in build.stdout
    assert "build --pull --no-cache" in clean_build.stdout

    for target in (
        "prod-up",
        "prod-start-maintenance-web",
        "prod-start-api-web",
        "prod-start-worker",
    ):
        result = _run("make", "-n", target, cwd=PROJECT_ROOT)
        assert "--remove-orphans" in result.stdout, target


async def test_api_json_startup_does_not_log_runtime_secrets(
    capfd: pytest.CaptureFixture[str],
) -> None:
    secret = "api-runtime-secret"
    app = create_app(
        Settings(
            database_url=f"postgresql://openerp:{secret}@db.example:5432/openerp",
            smtp_password=secret,
            bootstrap_admin_password=secret,
            log_format="json",
        )
    )

    async with app.router.lifespan_context(app):
        pass

    lines = [json.loads(line) for line in capfd.readouterr().out.splitlines()]
    assert any(line["message"] == "app.startup" for line in lines)
    assert all(secret not in json.dumps(line) for line in lines)


def _worker_startup_line(fmt: str) -> str:
    environment = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "OPENERP_DATABASE_URL": "postgresql://openerp:worker-runtime-secret@127.0.0.1:1/openerp",
        "OPENERP_LOG_FORMAT": fmt,
        "OPENERP_LOG_LEVEL": "INFO",
    }
    environment.pop("OPENERP_DATABASE_URL_FILE", None)
    process = subprocess.Popen(
        [sys.executable, "-m", "app.jobs.worker"],
        cwd=BACKEND_ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert process.stdout is not None
        assert select.select([process.stdout], [], [], 10)[0], "worker did not emit startup logging"
        return str(process.stdout.readline()).rstrip("\n")
    finally:
        process.terminate()
        process.communicate(timeout=10)


def test_worker_honours_json_logging_without_runtime_secrets() -> None:
    line = _worker_startup_line("json")
    payload = json.loads(line)

    assert payload["logger"] == "app.jobs.worker"
    assert payload["message"].startswith("outbox worker starting")
    assert {"timestamp", "level", "logger", "message"} <= payload.keys()
    assert "worker-runtime-secret" not in line


def test_worker_keeps_console_logging_for_local_development() -> None:
    line = _worker_startup_line("console")

    assert "app.jobs.worker" in line
    assert "outbox worker starting" in line
    with pytest.raises(json.JSONDecodeError):
        json.loads(line)


@pytest.mark.skipif(
    not shutil.which("docker") or _run("docker", "info", check=False).returncode != 0,
    reason="requires Docker",
)
def test_remove_orphans_stays_within_its_compose_project(tmp_path: Path) -> None:
    project = f"openerp-b8-{uuid.uuid4().hex[:10]}"
    foreign_project = f"{project}-foreign"
    old = tmp_path / "old.yml"
    new = tmp_path / "new.yml"
    foreign = tmp_path / "foreign.yml"
    old.write_text(
        "services:\n"
        "  retained:\n"
        "    image: alpine:3.20\n"
        '    command: ["sh", "-c", "while :; do sleep 60; done"]\n'
        "  obsolete:\n"
        "    image: alpine:3.20\n"
        '    command: ["sh", "-c", "while :; do sleep 60; done"]\n'
    )
    new.write_text(
        "services:\n"
        "  retained:\n"
        "    image: alpine:3.20\n"
        '    command: ["sh", "-c", "while :; do sleep 60; done"]\n'
    )
    foreign.write_text(
        "services:\n"
        "  foreign:\n"
        "    image: alpine:3.20\n"
        '    command: ["sh", "-c", "while :; do sleep 60; done"]\n'
    )

    try:
        _run("docker", "compose", "-p", project, "-f", str(old), "up", "-d")
        _run("docker", "compose", "-p", foreign_project, "-f", str(foreign), "up", "-d")
        _run(
            "docker",
            "compose",
            "-p",
            project,
            "-f",
            str(new),
            "up",
            "-d",
            "--remove-orphans",
        )
        assert (
            _run(
                "docker", "compose", "-p", project, "-f", str(new), "ps", "-aq", "obsolete"
            ).stdout.strip()
            == ""
        )
        assert _run(
            "docker",
            "compose",
            "-p",
            foreign_project,
            "-f",
            str(foreign),
            "ps",
            "-q",
            "foreign",
        ).stdout.strip()
    finally:
        _run(
            "docker",
            "compose",
            "-p",
            project,
            "-f",
            str(new),
            "down",
            "--remove-orphans",
            check=False,
        )
        _run("docker", "compose", "-p", foreign_project, "-f", str(foreign), "down", check=False)
