"""Directed real-Nginx checks for the production HTTP perimeter."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest

from tests.conftest import BACKEND_ROOT

PROJECT_ROOT = BACKEND_ROOT.parent
PRODUCTION_IMAGE = "openerp-frontend:latest"
EXPECTED_CSP = (
    "default-src 'self'; base-uri 'self'; connect-src 'self' "
    "wss://*:8181 wss://*:8282 wss://*:8383 wss://*:8484; font-src 'self'; "
    "form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; "
    "object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'"
)
EXPECTED_HEADERS = {
    "content-security-policy": EXPECTED_CSP,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "strict-transport-security": "max-age=31536000",
}


def _run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=60, check=check)


def _docker_ready() -> bool:
    if not shutil.which("docker") or not shutil.which("openssl"):
        return False
    return (
        _run("docker", "info", check=False).returncode == 0
        and _run("docker", "image", "inspect", PRODUCTION_IMAGE, check=False).returncode == 0
    )


def _response(port: str, path: str, directory: Path) -> tuple[int, dict[str, str], str]:
    token = uuid.uuid4().hex
    headers_path = directory / f"headers-{token}"
    body_path = directory / f"body-{token}"
    result = _run(
        "curl",
        "-skS",
        "--max-time",
        "5",
        "-D",
        str(headers_path),
        "-o",
        str(body_path),
        "-w",
        "%{http_code}",
        f"https://127.0.0.1:{port}{path}",
    )
    headers: dict[str, str] = {}
    for line in headers_path.read_text().splitlines():
        if ":" in line:
            name, value = line.split(":", 1)
            headers[name.lower()] = value.strip()
    return int(result.stdout), headers, body_path.read_text()


def _assert_security_headers(headers: dict[str, str]) -> None:
    for name, value in EXPECTED_HEADERS.items():
        assert headers.get(name) == value
    assert headers.get("server") == "nginx"


def test_compose_keeps_api_internal_and_uses_one_trusted_worker() -> None:
    result = _run(
        "docker",
        "compose",
        "-f",
        str(PROJECT_ROOT / "docker" / "compose.prod.yml"),
        "--env-file",
        str(PROJECT_ROOT / ".env.production.example"),
        "config",
        "--no-env-resolution",
        "--format",
        "json",
    )
    config = json.loads(result.stdout)
    services = config["services"]

    assert "mailpit" not in services
    assert "ports" not in services["api"]
    assert services["api"]["expose"] == ["8000"]
    command = services["api"]["command"]
    assert command[command.index("--workers") + 1] == "1"
    assert command[command.index("--forwarded-allow-ips") + 1] == "172.30.0.10"
    assert services["web"]["ports"] == [
        {"mode": "ingress", "target": 80, "published": "80", "protocol": "tcp"},
        {"mode": "ingress", "target": 443, "published": "443", "protocol": "tcp"},
    ]
    postgres_port = services["postgres"]["ports"][0]
    assert postgres_port["host_ip"] == "127.0.0.1"


@pytest.mark.skipif(not _docker_ready(), reason="requires Docker and the production frontend image")
def test_real_nginx_surface_headers_maintenance_and_client_ip(tmp_path: Path) -> None:
    suffix = uuid.uuid4().hex[:10]
    network = f"openerp-a19-{suffix}"
    fake_api = f"openerp-a19-api-{suffix}"
    web = f"openerp-a19-web-{suffix}"
    maintenance = tmp_path / "maintenance"
    certs = tmp_path / "certs"
    maintenance.mkdir(mode=0o755)
    certs.mkdir(mode=0o700)
    fake_config = tmp_path / "fake-api.conf"
    fake_config.write_text(
        "server { listen 8000; server_tokens off; "
        "location = /api/v1/unauthorized { return 401; } "
        "location = /api/v1/limited { return 429; } "
        "location = /api/v1/error { return 500; } "
        "location / { "
        "default_type text/plain; add_header X-Seen-XFF $http_x_forwarded_for always; "
        'return 200 "$http_x_forwarded_for\\n"; } }\n'
    )
    _run(
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=web",
        "-keyout",
        str(certs / "privkey.pem"),
        "-out",
        str(certs / "fullchain.pem"),
    )

    try:
        _run("docker", "network", "create", "--subnet", "203.0.113.0/24", network)
        _run(
            "docker",
            "run",
            "-d",
            "--name",
            fake_api,
            "--network",
            network,
            "--network-alias",
            "api",
            "--ip",
            "203.0.113.30",
            "-v",
            f"{fake_config}:/etc/nginx/conf.d/default.conf:ro",
            PRODUCTION_IMAGE,
        )
        _run(
            "docker",
            "run",
            "-d",
            "--name",
            web,
            "--network",
            network,
            "--network-alias",
            "web",
            "--ip",
            "203.0.113.10",
            "-p",
            "127.0.0.1::443",
            "-v",
            f"{PROJECT_ROOT / 'docker/nginx/nginx.conf'}:/etc/nginx/conf.d/default.conf:ro",
            "-v",
            f"{PROJECT_ROOT / 'docker/nginx/security-headers.conf'}:"
            "/etc/nginx/snippets/openerp-security-headers.conf:ro",
            "-v",
            f"{PROJECT_ROOT / 'docker/nginx/maintenance.html'}:"
            "/usr/share/nginx/html/maintenance.html:ro",
            "-v",
            f"{maintenance}:/run/openerp-maintenance:ro",
            "-v",
            f"{certs}:/etc/nginx/certs:ro",
            PRODUCTION_IMAGE,
        )
        port = _run("docker", "port", web, "443/tcp").stdout.strip().rsplit(":", 1)[1]
        for _ in range(30):
            if (
                _run(
                    "curl",
                    "-skS",
                    "--max-time",
                    "1",
                    f"https://127.0.0.1:{port}/",
                    check=False,
                ).returncode
                == 0
            ):
                break
            time.sleep(0.1)
        else:
            pytest.fail(_run("docker", "logs", web, check=False).stderr)

        status, headers, index = _response(port, "/", tmp_path)
        assert status == 200
        _assert_security_headers(headers)
        assert "https://" not in index and "http://" not in index
        assert not re.search(r"<script(?![^>]+\bsrc=)[^>]*>", index)

        asset = re.search(r'(?:src|href)="(/assets/[^"]+)"', index)
        assert asset is not None
        status, headers, asset_body = _response(port, asset.group(1), tmp_path)
        assert status == 200
        _assert_security_headers(headers)
        assert "eval(" not in asset_body and "new Function" not in asset_body

        lazy_asset = re.search(r'"\./(EChartImpl-[^"]+\.js)"', asset_body)
        assert lazy_asset is not None
        status, headers, lazy_asset_body = _response(
            port, f"/assets/{lazy_asset.group(1)}", tmp_path
        )
        assert status == 200
        _assert_security_headers(headers)
        assert "eval(" not in lazy_asset_body and "new Function" not in lazy_asset_body

        status, headers, _ = _response(port, "/api/v1/probe", tmp_path)
        assert status == 200
        _assert_security_headers(headers)
        assert (
            _run(
                "docker",
                "exec",
                web,
                "wget",
                "-qO-",
                "http://127.0.0.1:8080/healthz",
            ).stdout.strip()
            == "ok"
        )

        for path, expected in (
            ("/api/v1/unauthorized", 401),
            ("/api/v1/limited", 429),
            ("/api/v1/error", 500),
        ):
            status, headers, _ = _response(port, path, tmp_path)
            assert status == expected
            _assert_security_headers(headers)

        for path in (
            "/api/invalid",
            "/api/docs",
            "/api/redoc",
            "/api/openapi.json",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/healthz",
            "/api/v1/health/live",
            "/api/v1/health/ready",
        ):
            status, headers, _ = _response(port, path, tmp_path)
            assert status == 404, path
            _assert_security_headers(headers)

        client_seen = _run(
            "docker",
            "run",
            "--rm",
            "--network",
            network,
            "--ip",
            "203.0.113.25",
            PRODUCTION_IMAGE,
            "wget",
            "-qO-",
            "--no-check-certificate",
            "--header",
            "X-Forwarded-For: 1.2.3.4",
            "https://web/api/v1/probe",
        )
        assert client_seen.stdout.strip() == "203.0.113.25"

        (maintenance / "enabled").touch()
        for path in ("/", "/api/v1/probe", "/api/invalid"):
            status, headers, _ = _response(port, path, tmp_path)
            assert status == 503
            _assert_security_headers(headers)
    finally:
        _run("docker", "rm", "-f", web, fake_api, check=False)
        _run("docker", "network", "rm", network, check=False)
