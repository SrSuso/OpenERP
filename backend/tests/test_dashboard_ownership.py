"""A10: dashboards and every child operation are private to their owner."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from unittest.mock import AsyncMock

from httpx import AsyncClient

PASSWORD = "correct horse battery staple"


async def _login_existing(client: AsyncClient, email: str) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": PASSWORD},
    )
    assert response.status_code == 200
    result: dict[str, Any] = response.json()
    return result


async def _create_dashboard(client: AsyncClient, name: str) -> dict[str, Any]:
    response = await client.post("/api/v1/dashboards", json={"name": name})
    assert response.status_code == 201
    result: dict[str, Any] = response.json()
    return result


async def _two_owners(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    user_a = await login(role_name="MANAGER", email="dashboard-a@example.com")
    dashboard_a = await _create_dashboard(client, "Principal")
    user_b = await login(role_name="MANAGER", email="dashboard-b@example.com")
    dashboard_b = await _create_dashboard(client, "Principal")
    return user_a, dashboard_a, user_b, dashboard_b


async def test_creation_and_listing_are_scoped_to_the_authenticated_owner(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """D1-D3/D9: equal names are valid, but each user sees only their row."""
    user_a, dashboard_a, user_b, dashboard_b = await _two_owners(client, login)

    assert dashboard_a["owner_user_id"] == user_a["id"]
    assert dashboard_b["owner_user_id"] == user_b["id"]
    assert [row["id"] for row in (await client.get("/api/v1/dashboards")).json()] == [
        dashboard_b["id"]
    ]

    await _login_existing(client, user_a["email"])
    assert [row["id"] for row in (await client.get("/api/v1/dashboards")).json()] == [
        dashboard_a["id"]
    ]


async def test_foreign_dashboard_id_and_widget_are_indistinguishable_from_missing(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """D4/D7: knowing both ids grants neither reads nor child mutation."""
    user_a = await login(role_name="MANAGER", email="widget-owner-a@example.com")
    dashboard_a = await _create_dashboard(client, "Privado A")
    added = await client.post(
        f"/api/v1/dashboards/{dashboard_a['id']}/widgets",
        json={
            "metric": "stock_value",
            "title": "Valor A",
            "params": {},
            "chart_type": "kpi",
        },
    )
    assert added.status_code == 201
    widget_id = added.json()["widgets"][0]["id"]

    await login(role_name="MANAGER", email="widget-owner-b@example.com")

    assert (await client.get(f"/api/v1/dashboards/{dashboard_a['id']}")).status_code == 404
    assert (
        await client.post(
            f"/api/v1/dashboards/{dashboard_a['id']}/widgets",
            json={
                "metric": "stock_value",
                "title": "Inyección B",
                "params": {},
                "chart_type": "kpi",
            },
        )
    ).status_code == 404
    assert (
        await client.delete(f"/api/v1/dashboards/{dashboard_a['id']}/widgets/{widget_id}")
    ).status_code == 404

    await _login_existing(client, user_a["email"])
    unchanged = await client.get(f"/api/v1/dashboards/{dashboard_a['id']}")
    assert unchanged.status_code == 200
    assert [row["id"] for row in unchanged.json()["widgets"]] == [widget_id]


async def test_foreign_widget_metrics_are_rejected_before_the_query_runs(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    monkeypatch: Any,
) -> None:
    """D8: a foreign widget cannot be used as a metric/config oracle."""
    await login(role_name="MANAGER", email="metric-owner-a@example.com")
    dashboard_a = await _create_dashboard(client, "Métricas A")
    added = await client.post(
        f"/api/v1/dashboards/{dashboard_a['id']}/widgets",
        json={
            "metric": "stock_value",
            "title": "Valor A",
            "params": {},
            "chart_type": "kpi",
        },
    )
    widget_id = added.json()["widgets"][0]["id"]
    run_metric = AsyncMock(return_value={"stock_value": "0.000000"})
    monkeypatch.setattr("app.dashboards.metrics.run_metric", run_metric)

    await login(role_name="MANAGER", email="metric-owner-b@example.com")
    response = await client.get(f"/api/v1/dashboards/{dashboard_a['id']}/widgets/{widget_id}/data")

    assert response.status_code == 404
    run_metric.assert_not_awaited()


async def test_one_owner_can_keep_multiple_dashboards_independent(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """D10: ownership does not impose one-dashboard-per-user uniqueness."""
    user = await login(role_name="MANAGER")
    first = await _create_dashboard(client, "Principal")
    second = await _create_dashboard(client, "Operaciones")

    listed = (await client.get("/api/v1/dashboards")).json()

    assert {row["id"] for row in listed} == {first["id"], second["id"]}
    assert {row["owner_user_id"] for row in listed} == {user["id"]}


async def test_owner_from_create_payload_cannot_override_current_user(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """D11: extra client data cannot select the effective owner."""
    current = await login(role_name="MANAGER")

    created = await client.post(
        "/api/v1/dashboards",
        json={"name": "Sin suplantación", "owner_user_id": current["id"] + 1000},
    )

    assert created.status_code == 201
    assert created.json()["owner_user_id"] == current["id"]


async def test_admin_uses_the_same_private_dashboard_boundary(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """Normal ADMIN endpoints do not silently become cross-owner support APIs."""
    await login(role_name="ADMIN", email="admin-dashboard-a@example.com")
    dashboard_a = await _create_dashboard(client, "Admin A")
    await login(role_name="ADMIN", email="admin-dashboard-b@example.com")

    assert (await client.get(f"/api/v1/dashboards/{dashboard_a['id']}")).status_code == 404
