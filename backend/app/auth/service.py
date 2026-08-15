"""Authentication business logic: login, session lifecycle, cookies."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import AuthSession
from app.auth.security import generate_session_token, hash_session_token, verify_password
from app.core.config import Settings
from app.core.errors import AuthenticationError, RateLimitedError
from app.core.rate_limit import SlidingWindowRateLimiter
from app.rbac.models import Role
from app.rbac.permissions import POS_ACCESS
from app.users.models import User

#: Module-level singleton (see app.core.rate_limit's own docstring for why
#: that's fine for this deployment model) — one shared hit-history for the
#: whole process, independent of any one request's Settings instance.
_login_rate_limiter = SlidingWindowRateLimiter()


def _rate_limit_keys(*, ip: str | None, email: str) -> tuple[str, str]:
    return f"ip:{ip or 'unknown'}", f"email:{email.strip().lower()}"


def check_login_rate_limit(settings: Settings, *, ip: str | None, email: str) -> None:
    """Raises before any password check runs, so a locked-out attempt
    never even reaches the (comparatively expensive) Argon2id hash — same
    reasoning as checking permissions before touching the database.

    The IP key uses a more generous limit than the email key (see
    `Settings`'s own docstring on the split): several employees on one
    store's shared IP mistyping their own passwords must not lock everyone
    out, while a single account is still protected tightly.
    """
    ip_key, email_key = _rate_limit_keys(ip=ip, email=email)
    if _login_rate_limiter.is_limited(
        ip_key,
        max_hits=settings.login_rate_limit_ip_max_attempts,
        window_seconds=settings.login_rate_limit_ip_window_seconds,
    ):
        raise RateLimitedError("Too many login attempts. Try again later.")
    if _login_rate_limiter.is_limited(
        email_key,
        max_hits=settings.login_rate_limit_max_attempts,
        window_seconds=settings.login_rate_limit_window_seconds,
    ):
        raise RateLimitedError("Too many login attempts. Try again later.")


def record_login_failure(settings: Settings, *, ip: str | None, email: str) -> None:
    ip_key, email_key = _rate_limit_keys(ip=ip, email=email)
    _login_rate_limiter.record(ip_key, window_seconds=settings.login_rate_limit_ip_window_seconds)
    _login_rate_limiter.record(email_key, window_seconds=settings.login_rate_limit_window_seconds)


def reset_login_rate_limit(*, ip: str | None, email: str) -> None:
    for key in _rate_limit_keys(ip=ip, email=email):
        _login_rate_limiter.reset(key)


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


async def authenticate_pos(session: AsyncSession, *, username: str, pin: str) -> User:
    """Authenticate a cashier through the POS-only username/PIN pair."""
    stmt = (
        select(User)
        .where(func.lower(User.pos_username) == username)
        .options(selectinload(User.role).selectinload(Role.permissions))
    )
    user = (await session.execute(stmt)).scalar_one_or_none()
    if (
        user is None
        or not user.is_active
        or not user.pos_access_enabled
        or user.pos_pin_hash is None
        or not verify_password(pin, user.pos_pin_hash)
        or POS_ACCESS not in {permission.key for permission in user.role.permissions}
    ):
        raise AuthenticationError("Invalid POS username or PIN.")
    return user


async def list_pos_login_users(session: AsyncSession) -> list[User]:
    """Return only intentionally enabled cashiers for the POS picker.

    This endpoint is intentionally unauthenticated: the picker is rendered
    before a POS session exists. It exposes neither email nor any credential
    material, and authentication still requires the user's PIN.
    """
    stmt = (
        select(User)
        .where(
            User.is_active.is_(True),
            User.pos_access_enabled.is_(True),
            User.pos_username.is_not(None),
            User.pos_pin_hash.is_not(None),
        )
        .options(selectinload(User.role).selectinload(Role.permissions))
        .order_by(User.full_name, User.pos_username)
    )
    users = list((await session.execute(stmt)).scalars())
    return [
        user
        for user in users
        if POS_ACCESS in {permission.key for permission in user.role.permissions}
    ]


async def create_session(
    session: AsyncSession,
    *,
    user: User,
    settings: Settings,
    user_agent: str | None,
    ip: str | None,
    surface: str = "ADMIN",
) -> tuple[AuthSession, str]:
    """Start a new session for ``user``. Returns the row and the raw token —
    the only place the raw token ever exists outside the client's cookie."""
    token = generate_session_token()
    now = datetime.now(UTC)
    auth_session = AuthSession(
        token_hash=hash_session_token(token),
        surface=surface,
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


async def revoke_user_sessions(
    session: AsyncSession, *, user_id: int, except_session_id: int | None = None
) -> None:
    """Revoke every live server-side session belonging to one user."""
    stmt = (
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    if except_session_id is not None:
        stmt = stmt.where(AuthSession.id != except_session_id)
    await session.execute(stmt)


def set_session_cookie(
    response: Response,
    token: str,
    expires_at: datetime,
    settings: Settings,
    *,
    cookie_name: str | None = None,
) -> None:
    response.set_cookie(
        cookie_name or settings.session_cookie_name,
        token,
        expires=expires_at,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(
    response: Response, settings: Settings, *, cookie_name: str | None = None
) -> None:
    response.delete_cookie(cookie_name or settings.session_cookie_name, path="/")
