"""Session resolution: /auth/me, /auth/logout, /auth/sessions."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def test_me_without_a_session_is_unauthenticated(client: AsyncClient) -> None:
    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


async def test_me_with_a_valid_session_returns_the_user(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    logged_in = await login(role_name="ADMIN")

    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json()["email"] == logged_in["email"]


async def test_logout_revokes_the_session(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    logout_response = await client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 204

    me_response = await client.get("/api/v1/auth/me")
    assert me_response.status_code == 401


async def test_a_bogus_cookie_is_rejected(client: AsyncClient) -> None:
    client.cookies.set("openerp_session", "not-a-real-token")

    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 401


async def test_list_sessions_marks_the_current_one(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.get("/api/v1/auth/sessions")

    assert response.status_code == 200
    sessions = response.json()
    assert len(sessions) == 1
    assert sessions[0]["is_current"] is True


async def test_revoking_another_session_logs_it_out(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")
    current_session_id = (await client.get("/api/v1/auth/sessions")).json()[0]["id"]

    # A revoke on someone else's session id (or one that doesn't exist) must
    # not succeed — only the caller's own sessions are reachable.
    response = await client.delete("/api/v1/auth/sessions/999999")
    assert response.status_code == 404

    response = await client.delete(f"/api/v1/auth/sessions/{current_session_id}")
    assert response.status_code == 204

    me_response = await client.get("/api/v1/auth/me")
    assert me_response.status_code == 401
