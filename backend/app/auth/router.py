"""Login, logout and session introspection."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from app.api.client import client_ip
from app.auth import service
from app.auth.dependencies import AuthSessionDep, CurrentUser, SessionDep, SettingsDep
from app.auth.models import AuthSession
from app.auth.schemas import LoginRequest, MeResponse, SessionRead
from app.core.errors import AuthenticationError, NotFoundError
from app.rbac.dependencies import user_permissions
from app.users.models import User

router = APIRouter(tags=["auth"])


def _me(user: User) -> MeResponse:
    return MeResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.name,
        permissions=sorted(user_permissions(user)),
        must_change_password=user.must_change_password,
    )


@router.post("/auth/login", response_model=MeResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
) -> MeResponse:
    ip = client_ip(request)
    # Phase 19: checked before the password is even hashed, so a locked-out
    # caller never gets to spend that CPU either.
    service.check_login_rate_limit(settings, ip=ip, email=payload.email)
    try:
        user = await service.authenticate(session, email=payload.email, password=payload.password)
    except AuthenticationError:
        service.record_login_failure(settings, ip=ip, email=payload.email)
        raise
    service.reset_login_rate_limit(ip=ip, email=payload.email)

    auth_session, token = await service.create_session(
        session, user=user, settings=settings, user_agent=request.headers.get("user-agent"), ip=ip
    )
    service.set_session_cookie(response, token, auth_session.expires_at, settings)
    return _me(user)


@router.post("/auth/logout", status_code=204)
async def logout(
    auth_session: AuthSessionDep, response: Response, session: SessionDep, settings: SettingsDep
) -> None:
    await service.revoke_session(session, auth_session)
    service.clear_session_cookie(response, settings)


@router.get("/auth/me", response_model=MeResponse)
async def me(user: CurrentUser) -> MeResponse:
    return _me(user)


@router.get("/auth/sessions", response_model=list[SessionRead])
async def list_my_sessions(auth_session: AuthSessionDep, session: SessionDep) -> list[SessionRead]:
    """Every non-revoked session for the signed-in user — lets a cashier see
    (and close) other terminals they're still logged into."""
    stmt = (
        select(AuthSession)
        .where(AuthSession.user_id == auth_session.user_id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.last_seen_at.desc())
    )
    sessions = (await session.execute(stmt)).scalars()
    return [
        SessionRead(
            id=s.id,
            created_at=s.created_at,
            last_seen_at=s.last_seen_at,
            expires_at=s.expires_at,
            user_agent=s.user_agent,
            ip=s.ip,
            is_current=(s.id == auth_session.id),
        )
        for s in sessions
    ]


@router.delete("/auth/sessions/{session_id}", status_code=204)
async def revoke_my_session(
    session_id: int, auth_session: AuthSessionDep, session: SessionDep
) -> None:
    target = await session.get(AuthSession, session_id)
    if target is None or target.user_id != auth_session.user_id:
        raise NotFoundError("Session not found.")
    await service.revoke_session(session, target)
