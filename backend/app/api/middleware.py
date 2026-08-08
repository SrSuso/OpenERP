"""HTTP middleware: request id propagation, access logging, security
headers."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.core.config import Settings
from app.core.context import new_request_id, request_context
from app.core.logging import get_logger

logger = get_logger("app.access")

REQUEST_ID_HEADER = "X-Request-ID"

#: Headers sent on every response, regardless of environment. No CSP here:
#: this backend also serves /api/docs and /api/redoc (Swagger UI / ReDoc),
#: both of which load their JS from a CDN — a strict CSP would break them,
#: and the actual HTML surfaces a browser renders untrusted content in are
#: the frontend SPA's own deployment, not this API.
_SECURITY_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Rule-agnostic hardening headers (phase 19) — none of these are a
    business rule, just baseline hygiene every response gets for free.
    ``Strict-Transport-Security`` is added only outside local/test/ci, the
    same "only once it's actually HTTPS" reasoning
    ``Settings.session_cookie_secure`` already uses for the session cookie.
    """

    def __init__(self, app: ASGIApp, *, settings: Settings) -> None:
        super().__init__(app)
        self._settings = settings

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for name, value in _SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if self._settings.environment == "production":
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
            )
        return response


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Bind a request id for the whole request and echo it back.

    An inbound ``X-Request-ID`` is honoured so a trace can span the frontend
    and the API; otherwise one is generated.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER)
        request_id = incoming if incoming and len(incoming) <= 64 else new_request_id()
        client_ip = request.client.host if request.client else None

        with request_context(request_id=request_id, client_ip=client_ip):
            started = time.perf_counter()
            try:
                response = await call_next(request)
            except Exception:
                # The exception handler builds the body; log the timing here so
                # failed requests still produce an access line.
                logger.warning(
                    "http.request.failed",
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                )
                raise

            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            response.headers[REQUEST_ID_HEADER] = request_id
            logger.info(
                "http.request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                },
            )
            return response
