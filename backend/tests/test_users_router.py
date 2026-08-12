"""User account endpoints."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from argon2 import PasswordHasher
from httpx import ASGITransport, AsyncClient
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.audit.models import AuditLog
from app.auth.models import AuthSession
from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.main import create_app
from app.rbac.models import Permission, Role
from app.users.models import User
from tests.conftest import DEFAULT_PASSWORD

_CONCURRENCY_HASHER = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)


async def _cashier_role_id(session: AsyncSession) -> int:
    role = (await session.execute(select(Role).where(Role.name == "CASHIER"))).scalar_one()
    return role.id


async def _role(session: AsyncSession, name: str) -> Role:
    stmt = select(Role).where(Role.name == name).options(selectinload(Role.permissions))
    return (await session.execute(stmt)).scalar_one()


async def test_admin_can_create_a_user(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    role_id = await _cashier_role_id(db_session)

    response = await client.post(
        "/api/v1/users",
        json={
            "email": "new.cashier@example.com",
            "full_name": "New Cashier",
            "password": "another-secure-pass",
            "role_id": role_id,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "new.cashier@example.com"
    assert body["role_name"] == "CASHIER"
    assert body["is_active"] is True


async def test_duplicate_email_is_a_conflict(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="ADMIN")
    role_id = await _cashier_role_id(db_session)
    payload = {
        "email": "dup@example.com",
        "full_name": "Dup",
        "password": "another-secure-pass",
        "role_id": role_id,
    }

    first = await client.post("/api/v1/users", json=payload)
    assert first.status_code == 201

    second = await client.post("/api/v1/users", json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "conflict"


async def test_deactivated_user_can_no_longer_log_in(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[Any]],
) -> None:
    await login(role_name="ADMIN")
    target = await make_user(email="soon-gone@example.com", role_name="CASHIER")

    response = await client.post(f"/api/v1/users/{target.id}/deactivate")
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    other_client_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "soon-gone@example.com", "password": DEFAULT_PASSWORD},
    )
    assert other_client_login.status_code == 401


async def test_user_can_change_their_own_password(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    logged_in = await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/users/me/password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "brand-new-password"},
    )
    assert response.status_code == 204

    await client.post("/api/v1/auth/logout")
    relogin = await client.post(
        "/api/v1/auth/login",
        json={"email": logged_in["email"], "password": "brand-new-password"},
    )
    assert relogin.status_code == 200


async def test_change_password_rejects_wrong_current_password(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    await login(role_name="ADMIN")

    response = await client.post(
        "/api/v1/users/me/password",
        json={"current_password": "not-the-current-one", "new_password": "brand-new-password"},
    )

    assert response.status_code == 422


async def test_manager_cannot_promote_themselves_to_admin(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    manager = await login(role_name="MANAGER")
    admin_role = await _role(db_session, "ADMIN")

    response = await client.patch(f"/api/v1/users/{manager['id']}", json={"role_id": admin_role.id})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


async def test_manager_cannot_create_an_admin(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    await login(role_name="MANAGER")
    admin_role = await _role(db_session, "ADMIN")

    response = await client.post(
        "/api/v1/users",
        json={
            "email": "forbidden-admin@example.com",
            "full_name": "Forbidden Admin",
            "password": "another-secure-pass",
            "role_id": admin_role.id,
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


async def test_manager_cannot_assign_a_custom_role_with_permissions_they_do_not_have(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
    db_session: AsyncSession,
) -> None:
    privileged_permission = (
        await db_session.execute(select(Permission).where(Permission.key == "roles.manage"))
    ).scalar_one()
    custom_role = Role(
        name="CUSTOM-PRIVILEGED",
        description="Contains a permission MANAGER does not have.",
        permissions=[privileged_permission],
    )
    db_session.add(custom_role)
    target = await make_user(email="custom-target@example.com", role_name="CASHIER")
    await db_session.flush()
    await login(role_name="MANAGER")

    response = await client.patch(f"/api/v1/users/{target.id}", json={"role_id": custom_role.id})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


async def test_manager_can_assign_cashier_when_cashier_permissions_are_within_their_own(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
    db_session: AsyncSession,
) -> None:
    manager_role = await _role(db_session, "MANAGER")
    cashier_role = await _role(db_session, "CASHIER")
    manager_keys = {permission.key for permission in manager_role.permissions}
    manager_role.permissions.extend(
        permission for permission in cashier_role.permissions if permission.key not in manager_keys
    )
    target = await make_user(email="assignable-target@example.com", role_name="MANAGER")
    await db_session.flush()
    await login(role_name="MANAGER")

    response = await client.patch(f"/api/v1/users/{target.id}", json={"role_id": cashier_role.id})

    assert response.status_code == 200
    assert response.json()["role_name"] == "CASHIER"


async def test_user_cannot_deactivate_themselves(
    client: AsyncClient, login: Callable[..., Awaitable[dict[str, Any]]]
) -> None:
    admin = await login(role_name="ADMIN")

    response = await client.post(f"/api/v1/users/{admin['id']}/deactivate")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


async def test_another_user_cannot_deactivate_the_last_recoverable_admin(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
) -> None:
    last_admin = await make_user(email="last-admin@example.com", role_name="ADMIN")
    await login(role_name="MANAGER")

    response = await client.post(f"/api/v1/users/{last_admin.id}/deactivate")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


async def test_one_of_two_recoverable_admins_can_be_deactivated(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
) -> None:
    await login(role_name="ADMIN")
    other_admin = await make_user(email="second-admin@example.com", role_name="ADMIN")

    response = await client.post(f"/api/v1/users/{other_admin.id}/deactivate")

    assert response.status_code == 200
    assert response.json()["is_active"] is False


async def test_last_recoverable_admin_cannot_downgrade_their_role(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    admin = await login(role_name="ADMIN")
    cashier_role = await _role(db_session, "CASHIER")

    response = await client.patch(f"/api/v1/users/{admin['id']}", json={"role_id": cashier_role.id})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


async def test_concurrent_deactivations_cannot_remove_both_recoverable_admins(
    settings: Settings,
    committing_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The advisory lock is intentionally tested with real commits/connections."""
    suffix = uuid.uuid4().hex[:10]
    emails = [f"concurrent-a-{suffix}@example.com", f"concurrent-b-{suffix}@example.com"]
    password_hash = _CONCURRENCY_HASHER.hash(DEFAULT_PASSWORD)
    async with committing_sessionmaker() as setup:
        admin_role = await _role(setup, "ADMIN")
        admins = [
            User(
                email=email,
                full_name=f"Concurrent admin {index}",
                password_hash=password_hash,
                role_id=admin_role.id,
            )
            for index, email in enumerate(emails, start=1)
        ]
        setup.add_all(admins)
        await setup.commit()
        admin_ids = [admin.id for admin in admins]

    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings

    async def _committing_request_session() -> AsyncIterator[AsyncSession]:
        async with committing_sessionmaker() as request_session:
            try:
                yield request_session
                await request_session.commit()
            except Exception:
                await request_session.rollback()
                raise

    app.dependency_overrides[get_session] = _committing_request_session
    transport = ASGITransport(app=app)
    try:
        async with (
            AsyncClient(transport=transport, base_url="http://testserver") as client_a,
            AsyncClient(transport=transport, base_url="http://testserver") as client_b,
        ):
            for http, email in zip((client_a, client_b), emails, strict=True):
                response = await http.post(
                    "/api/v1/auth/login", json={"email": email, "password": DEFAULT_PASSWORD}
                )
                assert response.status_code == 200

            responses = await asyncio.gather(
                client_a.post(f"/api/v1/users/{admin_ids[1]}/deactivate"),
                client_b.post(f"/api/v1/users/{admin_ids[0]}/deactivate"),
            )

        assert sorted(response.status_code for response in responses) == [200, 409]
        async with committing_sessionmaker() as verification:
            states = list(
                (
                    await verification.execute(select(User.is_active).where(User.id.in_(admin_ids)))
                ).scalars()
            )
            assert states.count(True) == 1
    finally:
        app.dependency_overrides.clear()
        async with committing_sessionmaker() as cleanup:
            await cleanup.execute(
                delete(AuditLog).where(
                    or_(
                        AuditLog.user_id.in_(admin_ids),
                        and_(
                            AuditLog.entity_type == "user",
                            AuditLog.entity_id.in_(admin_ids),
                        ),
                    )
                )
            )
            await cleanup.execute(delete(AuthSession).where(AuthSession.user_id.in_(admin_ids)))
            await cleanup.execute(delete(User).where(User.id.in_(admin_ids)))
            await cleanup.commit()
