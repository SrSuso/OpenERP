"""User account management."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.auth.security import hash_password, verify_password
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.rbac.models import Role
from app.users.models import User
from app.users.schemas import PasswordChange, UserCreate, UserUpdate


def _snapshot(user: User) -> dict[str, Any]:
    """JSON-safe view of a user for the audit trail. Never the password hash."""
    return {
        "email": user.email,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "role_id": user.role_id,
        "role_name": user.role.name,
    }


async def list_users(session: AsyncSession) -> list[User]:
    stmt = select(User).options(selectinload(User.role)).order_by(User.email)
    return list((await session.execute(stmt)).scalars())


async def get_user(session: AsyncSession, user_id: int) -> User:
    stmt = select(User).where(User.id == user_id).options(selectinload(User.role))
    user = (await session.execute(stmt)).scalar_one_or_none()
    if user is None:
        raise NotFoundError(f"User {user_id} not found.")
    return user


async def _role_or_422(session: AsyncSession, role_id: int) -> Role:
    role = await session.get(Role, role_id)
    if role is None:
        raise ValidationError(f"Role {role_id} does not exist.")
    return role


async def create_user(session: AsyncSession, payload: UserCreate) -> User:
    existing = (
        await session.execute(select(User).where(User.email == payload.email))
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("A user with this email already exists.")
    await _role_or_422(session, payload.role_id)

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


async def update_user(session: AsyncSession, user_id: int, payload: UserUpdate) -> User:
    user = await get_user(session, user_id)
    before = _snapshot(user)
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.role_id is not None:
        await _role_or_422(session, payload.role_id)
        user.role_id = payload.role_id
    await session.flush()
    updated = await get_user(session, user_id)
    await audit.record(
        session,
        action="updated",
        entity_type="user",
        entity_id=user_id,
        before=before,
        after=_snapshot(updated),
    )
    return updated


async def deactivate_user(session: AsyncSession, user_id: int) -> User:
    """Rule 14: users are never deleted, only deactivated."""
    user = await get_user(session, user_id)
    before = _snapshot(user)
    user.is_active = False
    await session.flush()
    await audit.record(
        session,
        action="deactivated",
        entity_type="user",
        entity_id=user_id,
        before=before,
        after=_snapshot(user),
    )
    return user


async def change_password(session: AsyncSession, user: User, payload: PasswordChange) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise ValidationError("Current password is incorrect.")
    user.password_hash = hash_password(payload.new_password)
    await session.flush()
    # Never before/after: nothing about a password belongs in a readable log.
    await audit.record(session, action="password_changed", entity_type="user", entity_id=user.id)
