"""GET /audit-log: permission gate, and that phase 1 mutations actually
write an entry (not just that the endpoint works in isolation)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Role
from tests.conftest import DEFAULT_PASSWORD


async def _cashier_role_id(session: AsyncSession) -> int:
    role = (await session.execute(select(Role).where(Role.name == "CASHIER"))).scalar_one()
    return role.id


async def test_requires_audit_read_permission(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="CASHIER")

    response = await client.get("/api/v1/audit-log")

    assert response.status_code == 403


async def test_manager_without_audit_read_is_forbidden(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    """MANAGER's phase 1 grant (admin.access, users.manage) doesn't include
    audit.read — only ADMIN gets it by default."""
    await login(role_name="MANAGER")

    response = await client.get("/api/v1/audit-log")

    assert response.status_code == 403


async def test_unauthenticated_is_401_not_403(client: AsyncClient) -> None:
    response = await client.get("/api/v1/audit-log")

    assert response.status_code == 401


async def test_creating_a_user_is_audited(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    admin = await login(role_name="ADMIN")
    role_id = await _cashier_role_id(db_session)

    create_response = await client.post(
        "/api/v1/users",
        json={
            "email": "audited-user@example.com",
            "full_name": "Audited User",
            "password": "a-secure-password-1",
            "role_id": role_id,
        },
    )
    assert create_response.status_code == 201
    new_user_id = create_response.json()["id"]

    log_response = await client.get(
        "/api/v1/audit-log", params={"entity_type": "user", "entity_id": new_user_id}
    )
    assert log_response.status_code == 200
    entries = log_response.json()
    assert len(entries) == 1
    entry = entries[0]
    assert entry["action"] == "created"
    assert entry["entity_type"] == "user"
    assert entry["entity_id"] == new_user_id
    assert entry["user_id"] == admin["id"]
    assert entry["after_data"]["email"] == "audited-user@example.com"
    assert entry["before_data"] is None
    # Never the password, hashed or otherwise.
    assert "password" not in entry["after_data"]


async def test_changing_a_password_is_audited_without_leaking_it(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    admin = await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/users/me/password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "a-brand-new-password"},
    )
    assert response.status_code == 204

    log_response = await client.get(
        "/api/v1/audit-log", params={"entity_type": "user", "entity_id": admin["id"]}
    )
    assert log_response.status_code == 200
    entries = [e for e in log_response.json() if e["action"] == "password_changed"]
    assert entries
    assert entries[0]["before_data"] is None
    assert entries[0]["after_data"] is None


async def test_granting_role_permissions_is_audited(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    role_id = (
        await client.post("/api/v1/roles", json={"name": "AUDITOR-TEST", "description": ""})
    ).json()["id"]
    await client.patch(
        f"/api/v1/roles/{role_id}/permissions", json={"permission_keys": ["pos.access"]}
    )

    log_response = await client.get(
        "/api/v1/audit-log", params={"entity_type": "role", "entity_id": role_id}
    )
    actions = [e["action"] for e in log_response.json()]
    assert actions == ["permissions_changed", "created"]  # most recent first


async def test_user_security_administration_is_audited_without_password_material(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[Any]],
) -> None:
    target = await make_user(
        email="audited-security@example.com", role_name="CASHIER", is_active=False
    )
    await login(role_name="ADMIN")

    assert (await client.post(f"/api/v1/users/{target.id}/activate")).status_code == 200
    assert (
        await client.post(
            f"/api/v1/users/{target.id}/reset-password",
            json={"temporary_password": "not-for-the-audit-log"},
        )
    ).status_code == 204
    assert (await client.post(f"/api/v1/users/{target.id}/deactivate")).status_code == 200

    entries = (
        await client.get(
            "/api/v1/audit-log", params={"entity_type": "user", "entity_id": target.id}
        )
    ).json()
    assert [entry["action"] for entry in entries] == [
        "deactivated",
        "password_reset",
        "activated",
    ]
    reset_entry = next(entry for entry in entries if entry["action"] == "password_reset")
    rendered = str(reset_entry).lower()
    assert "not-for-the-audit-log" not in rendered
    assert "password_hash" not in rendered


async def test_role_assignment_has_a_specific_audit_action(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[Any]],
    db_session: AsyncSession,
) -> None:
    target = await make_user(email="audited-role@example.com", role_name="MANAGER")
    await login(role_name="ADMIN")
    cashier_role = await _cashier_role_id(db_session)

    assert (
        await client.patch(f"/api/v1/users/{target.id}", json={"role_id": cashier_role})
    ).status_code == 200
    entries = (
        await client.get(
            "/api/v1/audit-log", params={"entity_type": "user", "entity_id": target.id}
        )
    ).json()

    assert entries[0]["action"] == "role_changed"
