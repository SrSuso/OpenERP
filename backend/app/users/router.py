"""User account endpoints.

Everything here needs ``users.manage`` except a signed-in user changing
their own password.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import AuthSessionDep, CurrentUser, SessionDep
from app.rbac.dependencies import require_permission
from app.rbac.permissions import USERS_MANAGE
from app.users import service
from app.users.models import User
from app.users.schemas import (
    AdminPasswordReset,
    PasswordChange,
    PosAccessUpdate,
    PosCredentialsUpdate,
    UserCreate,
    UserRead,
    UserUpdate,
)

router = APIRouter(tags=["users"])

_require_users_manage = Depends(require_permission(USERS_MANAGE))


def _to_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        role_id=user.role_id,
        role_name=user.role.name,
        pos_username=user.pos_username,
        pos_pin_configured=user.pos_pin_hash is not None,
        pos_access_enabled=user.pos_access_enabled,
    )


@router.get("/users", response_model=list[UserRead], dependencies=[_require_users_manage])
async def list_users(session: SessionDep) -> list[UserRead]:
    return [_to_read(u) for u in await service.list_users(session)]


@router.post(
    "/users", response_model=UserRead, status_code=201, dependencies=[_require_users_manage]
)
async def create_user(payload: UserCreate, actor: CurrentUser, session: SessionDep) -> UserRead:
    return _to_read(await service.create_user(session, payload, actor=actor))


@router.get("/users/{user_id}", response_model=UserRead, dependencies=[_require_users_manage])
async def get_user(user_id: int, session: SessionDep) -> UserRead:
    return _to_read(await service.get_user(session, user_id))


@router.patch("/users/{user_id}", response_model=UserRead, dependencies=[_require_users_manage])
async def update_user(
    user_id: int, payload: UserUpdate, actor: CurrentUser, session: SessionDep
) -> UserRead:
    return _to_read(await service.update_user(session, user_id, payload, actor=actor))


@router.post(
    "/users/{user_id}/deactivate",
    response_model=UserRead,
    dependencies=[_require_users_manage],
)
async def deactivate_user(user_id: int, actor: CurrentUser, session: SessionDep) -> UserRead:
    return _to_read(await service.deactivate_user(session, user_id, actor=actor))


@router.post(
    "/users/{user_id}/activate",
    response_model=UserRead,
    dependencies=[_require_users_manage],
)
async def activate_user(user_id: int, actor: CurrentUser, session: SessionDep) -> UserRead:
    return _to_read(await service.activate_user(session, user_id, actor=actor))


@router.post(
    "/users/{user_id}/reset-password",
    status_code=204,
    dependencies=[_require_users_manage],
)
async def reset_password(
    user_id: int,
    payload: AdminPasswordReset,
    actor: CurrentUser,
    session: SessionDep,
) -> None:
    await service.reset_password(session, user_id, payload, actor=actor)


@router.put(
    "/users/{user_id}/pos-credentials",
    response_model=UserRead,
    dependencies=[_require_users_manage],
)
async def set_pos_credentials(
    user_id: int,
    payload: PosCredentialsUpdate,
    actor: CurrentUser,
    session: SessionDep,
) -> UserRead:
    return _to_read(await service.set_pos_credentials(session, user_id, payload, actor=actor))


@router.patch(
    "/users/{user_id}/pos-access",
    response_model=UserRead,
    dependencies=[_require_users_manage],
)
async def set_pos_access(
    user_id: int, payload: PosAccessUpdate, actor: CurrentUser, session: SessionDep
) -> UserRead:
    return _to_read(await service.set_pos_access(session, user_id, payload, actor=actor))


@router.post("/users/me/password", status_code=204)
async def change_my_password(
    payload: PasswordChange, auth_session: AuthSessionDep, session: SessionDep
) -> None:
    """Any authenticated user may change their own password — no
    ``users.manage`` needed, it only ever touches the caller's own row."""
    await service.change_password(
        session,
        auth_session.user,
        payload,
        current_session_id=auth_session.id,
    )
