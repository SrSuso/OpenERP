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
from app.auth.security import verify_password
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


async def test_admin_can_edit_an_existing_users_name_and_email(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[Any]],
) -> None:
    await login(role_name="ADMIN")
    target = await make_user(email="before@example.com", role_name="CASHIER", full_name="Antes")

    response = await client.patch(
        f"/api/v1/users/{target.id}",
        json={"email": "after@example.com", "full_name": "Después"},
    )

    assert response.status_code == 200
    assert response.json()["email"] == "after@example.com"
    assert response.json()["full_name"] == "Después"


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


async def test_manager_cannot_deactivate_a_more_privileged_user(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
) -> None:
    target = await make_user(email="protected-admin@example.com", role_name="ADMIN")
    await make_user(email="other-admin@example.com", role_name="ADMIN")
    await login(role_name="MANAGER")

    response = await client.post(f"/api/v1/users/{target.id}/deactivate")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


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


async def test_admin_can_reactivate_an_inactive_user(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
) -> None:
    target = await make_user(
        email="reactivated-user@example.com", role_name="CASHIER", is_active=False
    )
    await login(role_name="ADMIN")

    response = await client.post(f"/api/v1/users/{target.id}/activate")

    assert response.status_code == 200
    assert response.json()["is_active"] is True
    relogin = await client.post(
        "/api/v1/auth/login",
        json={"email": target.email, "password": DEFAULT_PASSWORD},
    )
    assert relogin.status_code == 200


async def test_admin_can_reset_another_users_password(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
    db_session: AsyncSession,
) -> None:
    target = await make_user(email="password-reset@example.com", role_name="CASHIER")
    await login(role_name="ADMIN")

    response = await client.post(
        f"/api/v1/users/{target.id}/reset-password",
        json={"temporary_password": "temporary-password-42"},
    )

    assert response.status_code == 204
    await db_session.refresh(target)
    assert verify_password("temporary-password-42", target.password_hash)
    assert target.must_change_password is True


async def test_admin_password_reset_revokes_the_targets_existing_sessions(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
    db_session: AsyncSession,
) -> None:
    target = await make_user(email="reset-sessions@example.com", role_name="CASHIER")
    assert (
        await client.post(
            "/api/v1/auth/login",
            json={"email": target.email, "password": DEFAULT_PASSWORD},
        )
    ).status_code == 200
    old_token = client.cookies.get("openerp_session")
    assert old_token is not None
    await login(role_name="ADMIN")

    response = await client.post(
        f"/api/v1/users/{target.id}/reset-password",
        json={"temporary_password": "temporary-password-42"},
    )
    assert response.status_code == 204
    old_session = (
        await db_session.execute(select(AuthSession).where(AuthSession.user_id == target.id))
    ).scalar_one()
    assert old_session.revoked_at is not None

    client.cookies.clear()
    client.cookies.set("openerp_session", old_token)
    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def test_temporary_password_requires_change_then_allows_normal_access(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
) -> None:
    target = await make_user(email="forced-change@example.com", role_name="CASHIER")
    await login(role_name="ADMIN")
    reset = await client.post(
        f"/api/v1/users/{target.id}/reset-password",
        json={"temporary_password": "temporary-password-42"},
    )
    assert reset.status_code == 204

    logged_in = await client.post(
        "/api/v1/auth/login",
        json={"email": target.email, "password": "temporary-password-42"},
    )
    assert logged_in.status_code == 200
    assert logged_in.json()["must_change_password"] is True

    restricted = await client.get("/api/v1/products")
    assert restricted.status_code == 403
    assert restricted.json()["error"]["code"] == "password_change_required"
    assert (await client.get("/api/v1/auth/me")).status_code == 200

    changed = await client.post(
        "/api/v1/users/me/password",
        json={
            "current_password": "temporary-password-42",
            "new_password": "permanent-password-84",
        },
    )
    assert changed.status_code == 204
    assert (await client.get("/api/v1/products")).status_code == 200

    await client.post("/api/v1/auth/logout")
    assert (
        await client.post(
            "/api/v1/auth/login",
            json={"email": target.email, "password": "temporary-password-42"},
        )
    ).status_code == 401
    normal_login = await client.post(
        "/api/v1/auth/login",
        json={"email": target.email, "password": "permanent-password-84"},
    )
    assert normal_login.status_code == 200
    assert normal_login.json()["must_change_password"] is False


async def test_deactivation_revokes_existing_sessions(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
    db_session: AsyncSession,
) -> None:
    target = await make_user(email="deactivate-sessions@example.com", role_name="CASHIER")
    assert (
        await client.post(
            "/api/v1/auth/login",
            json={"email": target.email, "password": DEFAULT_PASSWORD},
        )
    ).status_code == 200
    await login(role_name="ADMIN")

    response = await client.post(f"/api/v1/users/{target.id}/deactivate")

    assert response.status_code == 200
    sessions = list(
        (
            await db_session.execute(select(AuthSession).where(AuthSession.user_id == target.id))
        ).scalars()
    )
    assert sessions and all(auth_session.revoked_at is not None for auth_session in sessions)


async def test_role_change_is_visible_to_an_existing_session_without_revocation(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    db_session: AsyncSession,
) -> None:
    manager = await login(role_name="MANAGER")
    manager_token = client.cookies.get("openerp_session")
    assert manager_token is not None
    await login(role_name="ADMIN")
    cashier_role = await _role(db_session, "CASHIER")

    response = await client.patch(
        f"/api/v1/users/{manager['id']}", json={"role_id": cashier_role.id}
    )
    assert response.status_code == 200

    client.cookies.clear()
    client.cookies.set("openerp_session", manager_token)
    denied = await client.get("/api/v1/users")
    assert denied.status_code == 403
    sessions = list(
        (
            await db_session.execute(
                select(AuthSession).where(AuthSession.user_id == manager["id"])
            )
        ).scalars()
    )
    assert sessions and all(auth_session.revoked_at is None for auth_session in sessions)


async def test_manager_cannot_reset_or_reactivate_a_more_privileged_account(
    client: AsyncClient,
    login: Callable[..., Awaitable[dict[str, Any]]],
    make_user: Callable[..., Awaitable[User]],
) -> None:
    target = await make_user(email="inactive-admin@example.com", role_name="ADMIN", is_active=False)
    await login(role_name="MANAGER")

    reset = await client.post(
        f"/api/v1/users/{target.id}/reset-password",
        json={"temporary_password": "temporary-password-42"},
    )
    activate = await client.post(f"/api/v1/users/{target.id}/activate")

    assert reset.status_code == 403
    assert activate.status_code == 403
