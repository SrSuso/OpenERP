"""User account management."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.auth import service as auth_service
from app.auth.security import hash_password, verify_password
from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from app.rbac.models import Role
from app.rbac.policy import (
    ensure_role_is_assignable,
    ensure_user_transition_preserves_recovery,
    lock_recoverable_admin_invariant,
)
from app.users.models import User
from app.users.schemas import AdminPasswordReset, PasswordChange, UserCreate, UserUpdate


def _snapshot(user: User) -> dict[str, Any]:
    """JSON-safe view of a user for the audit trail. Never the password hash."""
    return {
        "email": user.email,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "role_id": user.role_id,
        "role_name": user.role.name,
    }


async def list_users(session: AsyncSession) -> list[User]:
    stmt = select(User).options(selectinload(User.role)).order_by(User.email)
    return list((await session.execute(stmt)).scalars())


async def get_user(session: AsyncSession, user_id: int) -> User:
    stmt = (
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.role).selectinload(Role.permissions))
    )
    user = (await session.execute(stmt)).scalar_one_or_none()
    if user is None:
        raise NotFoundError(f"User {user_id} not found.")
    return user


async def _role_or_422(session: AsyncSession, role_id: int) -> Role:
    stmt = select(Role).where(Role.id == role_id).options(selectinload(Role.permissions))
    role = (await session.execute(stmt)).scalar_one_or_none()
    if role is None:
        raise ValidationError(f"Role {role_id} does not exist.")
    return role


async def create_user(session: AsyncSession, payload: UserCreate, *, actor: User) -> User:
    existing = (
        await session.execute(select(User).where(User.email == payload.email))
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("A user with this email already exists.")
    role = await _role_or_422(session, payload.role_id)
    ensure_role_is_assignable(actor, role)

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role_id=payload.role_id,
    )
    session.add(user)
    await session.flush()
    created = await get_user(session, user.id)
    await audit.record(
        session,
        action="created",
        entity_type="user",
        entity_id=created.id,
        after=_snapshot(created),
    )
    return created


async def update_user(
    session: AsyncSession, user_id: int, payload: UserUpdate, *, actor: User
) -> User:
    if payload.role_id is not None:
        await lock_recoverable_admin_invariant(session)
    user = await get_user(session, user_id)
    before = _snapshot(user)
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.role_id is not None:
        role = await _role_or_422(session, payload.role_id)
        ensure_role_is_assignable(actor, role)
        await ensure_user_transition_preserves_recovery(
            session, user=user, role=role, is_active=user.is_active
        )
        # Keep the already-loaded relationship coherent for this response;
        # changing only role_id would leave ``user.role`` stale in the
        # identity map until a later request.
        user.role = role
    await session.flush()
    updated = await get_user(session, user_id)
    await audit.record(
        session,
        action="role_changed" if payload.role_id is not None else "updated",
        entity_type="user",
        entity_id=user_id,
        before=before,
        after=_snapshot(updated),
    )
    return updated


async def deactivate_user(session: AsyncSession, user_id: int, *, actor: User) -> User:
    """Rule 14: users are never deleted, only deactivated."""
    if user_id == actor.id:
        raise PermissionDeniedError("You cannot deactivate your own account.")
    await lock_recoverable_admin_invariant(session)
    user = await get_user(session, user_id)
    await ensure_user_transition_preserves_recovery(
        session, user=user, role=user.role, is_active=False
    )
    before = _snapshot(user)
    user.is_active = False
    await session.flush()
    await auth_service.revoke_user_sessions(session, user_id=user.id)
    await audit.record(
        session,
        action="deactivated",
        entity_type="user",
        entity_id=user_id,
        before=before,
        after=_snapshot(user),
    )
    return user


async def activate_user(session: AsyncSession, user_id: int, *, actor: User) -> User:
    user = await get_user(session, user_id)
    ensure_role_is_assignable(actor, user.role)
    if user.is_active:
        return user
    before = _snapshot(user)
    user.is_active = True
    await session.flush()
    await audit.record(
        session,
        action="activated",
        entity_type="user",
        entity_id=user_id,
        before=before,
        after=_snapshot(user),
    )
    return user


async def reset_password(
    session: AsyncSession,
    user_id: int,
    payload: AdminPasswordReset,
    *,
    actor: User,
) -> None:
    if user_id == actor.id:
        raise PermissionDeniedError("Use the personal password-change flow for your own account.")
    user = await get_user(session, user_id)
    ensure_role_is_assignable(actor, user.role)
    user.password_hash = hash_password(payload.temporary_password)
    user.must_change_password = True
    await auth_service.revoke_user_sessions(session, user_id=user.id)
    await session.flush()
    # Passwords and hashes are deliberately absent from both snapshots.
    await audit.record(
        session,
        action="password_reset",
        entity_type="user",
        entity_id=user.id,
        after={"must_change_password": True},
    )


async def change_password(
    session: AsyncSession,
    user: User,
    payload: PasswordChange,
    *,
    current_session_id: int,
) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise ValidationError("Current password is incorrect.")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    await auth_service.revoke_user_sessions(
        session, user_id=user.id, except_session_id=current_session_id
    )
    await session.flush()
    # Never before/after: nothing about a password belongs in a readable log.
    await audit.record(session, action="password_changed", entity_type="user", entity_id=user.id)
