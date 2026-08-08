"""User account management."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.security import hash_password, verify_password
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.rbac.models import Role
from app.users.models import User
from app.users.schemas import PasswordChange, UserCreate, UserUpdate


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
    return await get_user(session, user.id)


async def update_user(session: AsyncSession, user_id: int, payload: UserUpdate) -> User:
    user = await get_user(session, user_id)
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.role_id is not None:
        await _role_or_422(session, payload.role_id)
        user.role_id = payload.role_id
    await session.flush()
    return await get_user(session, user_id)


async def deactivate_user(session: AsyncSession, user_id: int) -> User:
    """Rule 14: users are never deleted, only deactivated."""
    user = await get_user(session, user_id)
    user.is_active = False
    await session.flush()
    return user


async def change_password(session: AsyncSession, user: User, payload: PasswordChange) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise ValidationError("Current password is incorrect.")
    user.password_hash = hash_password(payload.new_password)
    await session.flush()
