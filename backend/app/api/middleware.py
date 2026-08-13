"""HTTP request-id propagation and access logging."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.api.client import client_ip
from app.core.context import new_request_id, request_context
from app.core.logging import get_logger

logger = get_logger("app.access")

REQUEST_ID_HEADER = "X-Request-ID"


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
        remote_ip = client_ip(request)

        with request_context(request_id=request_id, client_ip=remote_ip):
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
