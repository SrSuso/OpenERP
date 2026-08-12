"""FastAPI dependencies that resolve the authenticated user from the session
cookie.

``get_current_user`` is what every protected router in every phase depends
on (directly, or through :func:`app.rbac.dependencies.require_permission`).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import AuthSession
from app.auth.security import hash_session_token
from app.auth.service import set_session_cookie
from app.core.config import Settings, get_settings
from app.core.context import set_user_id
from app.core.errors import AuthenticationError
from app.db.session import SessionDep as SessionDep
from app.rbac.models import Role
from app.users.models import User

SettingsDep = Annotated[Settings, Depends(get_settings)]


async def _load_session(session: AsyncSession, token: str) -> AuthSession | None:
    token_hash = hash_session_token(token)
    stmt = (
        select(AuthSession)
        .where(AuthSession.token_hash == token_hash)
        .options(
            selectinload(AuthSession.user).selectinload(User.role).selectinload(Role.permissions)
        )
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def get_current_auth_session(
    request: Request, response: Response, session: SessionDep, settings: SettingsDep
) -> AuthSession:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise AuthenticationError("Not authenticated.")

    auth_session = await _load_session(session, token)
    now = datetime.now(UTC)
    if (
        auth_session is None
        or auth_session.revoked_at is not None
        or auth_session.expires_at <= now
    ):
        raise AuthenticationError("Session expired or invalid.")
    if not auth_session.user.is_active:
        raise AuthenticationError("User is deactivated.")

    # Sliding expiry, throttled: a busy terminal shouldn't turn every request
    # into a write, so only extend once per `session_touch_interval_seconds`.
    elapsed = (now - auth_session.last_seen_at).total_seconds()
    if elapsed >= settings.session_touch_interval_seconds:
        auth_session.last_seen_at = now
        auth_session.expires_at = now + timedelta(days=settings.session_ttl_days)
        set_session_cookie(response, token, auth_session.expires_at, settings)

    set_user_id(auth_session.user.id)
    return auth_session


AuthSessionDep = Annotated[AuthSession, Depends(get_current_auth_session)]


async def get_current_user(auth_session: AuthSessionDep) -> User:
    return auth_session.user


CurrentUser = Annotated[User, Depends(get_current_user)]
