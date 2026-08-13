"""The error envelope every endpoint shares."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from unittest.mock import patch

import pytest
from fastapi import APIRouter
from httpx import ASGITransport, AsyncClient

from app.core import errors as error_module
from app.core.config import Settings
from app.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.main import create_app

_ERRORS = [
    (NotFoundError("Product 7 does not exist."), 404, "not_found"),
    (ConflictError("SKU already in use."), 409, "conflict"),
    (ValidationError("Quantity must be positive."), 422, "validation_error"),
    (PermissionDeniedError("Missing permission user.write."), 403, "permission_denied"),
]


@pytest.fixture
def error_app(settings: Settings):  # type: ignore[no-untyped-def]
    """An app exposing one route per error type, plus an unhandled crash."""
    production = settings.model_copy(update={"environment": "production", "cors_origins": []})
    app = create_app(production)
    router = APIRouter()

    def _raiser(error: Exception) -> Callable[[], Awaitable[None]]:
        async def endpoint() -> None:
            raise error

        return endpoint

    for index, (exc, _, _) in enumerate(_ERRORS):
        router.add_api_route(f"/boom/{index}", _raiser(exc), methods=["GET"])

    router.add_api_route(
        "/boom/unhandled", _raiser(RuntimeError("something nobody mapped")), methods=["GET"]
    )

    app.include_router(router)
    return app


async def _get(app, path: str):  # type: ignore[no-untyped-def]
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.get(path)


@pytest.mark.parametrize(("index", "expected"), list(enumerate(_ERRORS)))
async def test_domain_errors_map_to_status_and_code(error_app, index, expected) -> None:  # type: ignore[no-untyped-def]
    exc, status_code, code = expected

    response = await _get(error_app, f"/boom/{index}")

    assert response.status_code == status_code
    body = response.json()
    assert body["error"]["code"] == code
    assert body["error"]["message"] == str(exc)
    assert body["request_id"]


async def test_unhandled_error_does_not_leak_internals(error_app) -> None:  # type: ignore[no-untyped-def]
    with patch.object(error_module.logger, "error") as logged:
        response = await _get(error_app, "/boom/unhandled")

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "internal_error"
    assert "something nobody mapped" not in body["error"]["message"]
    assert "traceback" not in response.text.lower()
    assert "/home/" not in response.text
    assert logged.call_count == 1
    assert "something nobody mapped" not in repr(logged.call_args)
    assert logged.call_args.kwargs["extra"]["error_type"] == "RuntimeError"
    assert logged.call_args.kwargs["extra"]["error_location"]["function"] == "endpoint"


async def test_unknown_route_uses_the_same_envelope(client: AsyncClient) -> None:
    response = await client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
