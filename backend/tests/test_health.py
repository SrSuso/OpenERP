"""Health endpoints."""

from __future__ import annotations

from httpx import AsyncClient

from app.api.middleware import REQUEST_ID_HEADER


async def test_live_reports_app_metadata(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "app": "OpenERP", "environment": "test"}


async def test_ready_queries_the_database(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


async def test_response_carries_a_request_id(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/live")

    assert response.headers[REQUEST_ID_HEADER]


async def test_inbound_request_id_is_propagated(client: AsyncClient) -> None:
    response = await client.get(
        "/api/v1/health/live", headers={REQUEST_ID_HEADER: "trace-from-frontend"}
    )

    assert response.headers[REQUEST_ID_HEADER] == "trace-from-frontend"


async def test_openapi_schema_is_served(client: AsyncClient) -> None:
    response = await client.get("/api/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "OpenERP"
    assert "/api/v1/health/live" in schema["paths"]
