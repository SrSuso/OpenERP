"""Backend-enforced authorisation (rule 11): require_permission and the
built-in ADMIN/MANAGER/CASHIER roles seeded by the phase 1 migration.

Covers the acceptance cases from the phase plan:
  1. Admin login.
  2. Cashier login has pos.access but not admin.access.
  3. Cashier gets 403 trying to manage users.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient


async def test_admin_can_log_in_and_has_full_permissions(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    admin = await login(role_name="ADMIN")

    assert admin["role"] == "ADMIN"
    for key in ("admin.access", "pos.access", "users.manage", "roles.manage"):
        assert key in admin["permissions"]


async def test_cashier_can_log_in_but_has_no_admin_access(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """CASHIER's permission set grows as later phases grant it more (e.g.
    product.read in phase 3) — what must never happen is admin.access or
    users.manage/roles.manage, so assert on those rather than an exact set."""
    cashier = await login(role_name="CASHIER")

    assert "pos.access" in cashier["permissions"]
    for key in ("admin.access", "users.manage", "roles.manage"):
        assert key not in cashier["permissions"]


async def test_cashier_gets_403_managing_users(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    response = await client.get("/api/v1/users")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


async def test_manager_can_manage_users_but_not_roles(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="MANAGER")

    users_response = await client.get("/api/v1/users")
    assert users_response.status_code == 200

    roles_response = await client.get("/api/v1/roles")
    assert roles_response.status_code == 403


async def test_unauthenticated_request_is_401_not_403(client: AsyncClient) -> None:
    """Missing a session and missing a permission are different failures —
    401 vs 403 — and callers (and the frontend redirect logic) rely on the
    distinction."""
    response = await client.get("/api/v1/users")

    assert response.status_code == 401
