"""Database-free production surface and trusted-proxy boundary tests."""

from __future__ import annotations

from typing import Any, cast

from fastapi import APIRouter, Request
from httpx import ASGITransport, AsyncClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.api.client import client_ip
from app.core.config import Environment, Settings
from app.core.context import get_client_ip
from app.core.rate_limit import SlidingWindowRateLimiter
from app.main import create_app


def _settings(*, environment: Environment, cors_origins: list[str]) -> Settings:
    return Settings(
        database_url="postgresql://user:password@db.example/openerp",
        environment=environment,
        cors_origins=cors_origins,
        log_format="console",
        log_level="WARNING",
    )


async def test_development_keeps_documentation_and_explicit_cors() -> None:
    app = create_app(_settings(environment="local", cors_origins=["http://localhost:5173"]))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://backend.test") as client:
        assert (await client.get("/api/docs")).status_code == 200
        assert (await client.get("/api/redoc")).status_code == 200
        assert (await client.get("/api/openapi.json")).status_code == 200
        cors = await client.options(
            "/api/v1/auth/login",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
    assert cors.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_production_without_cors_does_not_emit_allow_origin() -> None:
    app = create_app(_settings(environment="production", cors_origins=[]))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://backend.test") as client:
        response = await client.get(
            "/api/v1/health/live", headers={"Origin": "https://attacker.example"}
        )
    assert "access-control-allow-origin" not in response.headers


def _ip_probe_app() -> ProxyHeadersMiddleware:
    app = create_app(_settings(environment="production", cors_origins=[]))
    router = APIRouter()

    @router.get("/probe")
    async def probe(request: Request) -> dict[str, str | None]:
        return {"direct": client_ip(request), "context": get_client_ip()}

    app.include_router(router)
    return ProxyHeadersMiddleware(cast(Any, app), trusted_hosts=["10.0.0.10"])


async def test_direct_request_cannot_spoof_client_ip_with_forwarded_header() -> None:
    transport = ASGITransport(app=cast(Any, _ip_probe_app()), client=("198.51.100.20", 12345))
    async with AsyncClient(transport=transport, base_url="https://backend.test") as client:
        response = await client.get("/probe", headers={"X-Forwarded-For": "1.2.3.4"})

    assert response.json() == {"direct": "198.51.100.20", "context": "198.51.100.20"}


async def test_forwarded_ip_is_accepted_only_from_configured_proxy() -> None:
    transport = ASGITransport(app=cast(Any, _ip_probe_app()), client=("10.0.0.10", 12345))
    async with AsyncClient(transport=transport, base_url="https://backend.test") as client:
        response = await client.get("/probe", headers={"X-Forwarded-For": "203.0.113.25"})

    assert response.json() == {"direct": "203.0.113.25", "context": "203.0.113.25"}


def test_rate_limiter_history_has_a_hard_key_bound() -> None:
    limiter = SlidingWindowRateLimiter(max_keys=2)

    for key in ("first", "second", "third"):
        limiter.record(key, window_seconds=300)

    assert list(limiter._hits) == ["second", "third"]
