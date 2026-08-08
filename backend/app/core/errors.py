"""Domain error types and the HTTP error envelope.

Every error the API returns has the same shape, so the frontend can handle
failures generically::

    {
      "error": {"code": "not_found", "message": "...", "details": {...}},
      "request_id": "…"
    }
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.context import get_request_id
from app.core.logging import get_logger

logger = get_logger(__name__)


class AppError(Exception):
    """Base class for expected, mapped application errors."""

    code: str = "error"
    status_code: int = status.HTTP_400_BAD_REQUEST

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(AppError):
    code = "not_found"
    status_code = status.HTTP_404_NOT_FOUND


class ConflictError(AppError):
    """The request collides with the current state (duplicate key, stale write)."""

    code = "conflict"
    status_code = status.HTTP_409_CONFLICT


class ValidationError(AppError):
    """Business-rule violation (as opposed to a schema/parsing failure)."""

    code = "validation_error"
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT


class AuthenticationError(AppError):
    code = "unauthenticated"
    status_code = status.HTTP_401_UNAUTHORIZED


class PermissionDeniedError(AppError):
    code = "permission_denied"
    status_code = status.HTTP_403_FORBIDDEN


class ServiceUnavailableError(AppError):
    code = "service_unavailable"
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE


class RateLimitedError(AppError):
    """Phase 19: too many attempts (``app.core.rate_limit``) — the 429
    mapping in ``_STATUS_CODES`` below already anticipated this."""

    code = "rate_limited"
    status_code = status.HTTP_429_TOO_MANY_REQUESTS


def error_response(
    *, code: str, message: str, status_code: int, details: dict[str, Any] | None = None
) -> JSONResponse:
    body: dict[str, Any] = {
        "error": {"code": code, "message": message, "details": details or {}},
        "request_id": get_request_id(),
    }
    return JSONResponse(status_code=status_code, content=body)


# HTTP status -> stable error code, for exceptions raised as bare HTTPException.
_STATUS_CODES = {
    status.HTTP_400_BAD_REQUEST: "bad_request",
    status.HTTP_401_UNAUTHORIZED: "unauthenticated",
    status.HTTP_403_FORBIDDEN: "permission_denied",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_422_UNPROCESSABLE_CONTENT: "validation_error",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
    status.HTTP_503_SERVICE_UNAVAILABLE: "service_unavailable",
}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        logger.info(
            "request.app_error",
            extra={"error_code": exc.code, "error_message": exc.message},
        )
        return error_response(
            code=exc.code,
            message=exc.message,
            status_code=exc.status_code,
            details=exc.details,
        )

    @app.exception_handler(RequestValidationError)
    async def _request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            code="request_validation_error",
            message="Request payload failed validation.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details={"errors": _jsonable_errors(exc)},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, "http_error")
        return error_response(code=code, message=str(exc.detail), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("request.unhandled_error", extra={"error_type": type(exc).__name__})
        return error_response(
            code="internal_error",
            message="An unexpected error occurred.",
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


def _jsonable_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    """Strip non-serialisable payloads (``ctx`` may carry exception objects)."""
    cleaned: list[dict[str, Any]] = []
    for err in exc.errors():
        cleaned.append(
            {
                "loc": [str(part) for part in err.get("loc", ())],
                "msg": err.get("msg", ""),
                "type": err.get("type", ""),
            }
        )
    return cleaned
