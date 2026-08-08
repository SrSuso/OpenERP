"""Authentication business logic: login, session lifecycle, cookies."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import AuthSession
from app.auth.security import generate_session_token, hash_session_token, verify_password
from app.core.config import Settings
from app.core.errors import AuthenticationError
from app.rbac.models import Role
from app.users.models import User


async def authenticate(session: AsyncSession, *, email: str, password: str) -> User:
    """Resolve credentials to an active user.

    Deliberately gives the same error for "no such user" and "wrong
    password" — distinguishing them lets an attacker enumerate accounts.
    """
    stmt = (
        select(User)
        .where(User.email == email)
        .options(selectinload(User.role).selectinload(Role.permissions))
    )
    user = (await session.execute(stmt)).scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        raise AuthenticationError("Invalid email or password.")
    return user


async def create_session(
    session: AsyncSession,
    *,
    user: User,
    settings: Settings,
    user_agent: str | None,
    ip: str | None,
) -> tuple[AuthSession, str]:
    """Start a new session for ``user``. Returns the row and the raw token —
    the only place the raw token ever exists outside the client's cookie."""
    token = generate_session_token()
    now = datetime.now(UTC)
    auth_session = AuthSession(
        token_hash=hash_session_token(token),
        user_id=user.id,
        expires_at=now + timedelta(days=settings.session_ttl_days),
        last_seen_at=now,
        user_agent=(user_agent or "")[:255] or None,
        ip=ip,
    )
    session.add(auth_session)
    await session.flush()
    return auth_session, token


async def revoke_session(session: AsyncSession, auth_session: AuthSession) -> None:
    auth_session.revoked_at = datetime.now(UTC)
    await session.flush()


def set_session_cookie(
    response: Response, token: str, expires_at: datetime, settings: Settings
) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        expires=expires_at,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/")
