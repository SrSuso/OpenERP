"""Role and permission management. Everything here needs ``roles.manage``."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.auth.dependencies import SessionDep
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.rbac.dependencies import require_permission
from app.rbac.models import Permission, Role
from app.rbac.permissions import ROLES_MANAGE
from app.rbac.schemas import PermissionRead, RoleCreate, RolePermissionsUpdate, RoleRead

router = APIRouter(tags=["rbac"], dependencies=[Depends(require_permission(ROLES_MANAGE))])


def _to_read(role: Role) -> RoleRead:
    return RoleRead(
        id=role.id,
        name=role.name,
        description=role.description,
        permissions=sorted(p.key for p in role.permissions),
    )


@router.get("/roles", response_model=list[RoleRead])
async def list_roles(session: SessionDep) -> list[RoleRead]:
    stmt = select(Role).options(selectinload(Role.permissions)).order_by(Role.name)
    roles = (await session.execute(stmt)).scalars()
    return [_to_read(r) for r in roles]


@router.get("/permissions", response_model=list[PermissionRead])
async def list_permissions(session: SessionDep) -> list[PermissionRead]:
    stmt = select(Permission).order_by(Permission.key)
    permissions = (await session.execute(stmt)).scalars()
    return [PermissionRead(id=p.id, key=p.key, description=p.description) for p in permissions]


@router.post("/roles", response_model=RoleRead, status_code=201)
async def create_role(payload: RoleCreate, session: SessionDep) -> RoleRead:
    existing = (
        await session.execute(select(Role).where(Role.name == payload.name))
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("A role with this name already exists.")

    role = Role(name=payload.name, description=payload.description)
    session.add(role)
    await session.flush()
    await session.refresh(role, attribute_names=["permissions"])
    return _to_read(role)


@router.patch("/roles/{role_id}/permissions", response_model=RoleRead)
async def set_role_permissions(
    role_id: int, payload: RolePermissionsUpdate, session: SessionDep
) -> RoleRead:
    stmt = select(Role).where(Role.id == role_id).options(selectinload(Role.permissions))
    role = (await session.execute(stmt)).scalar_one_or_none()
    if role is None:
        raise NotFoundError(f"Role {role_id} not found.")

    permissions: list[Permission] = []
    if payload.permission_keys:
        perm_stmt = select(Permission).where(Permission.key.in_(payload.permission_keys))
        permissions = list((await session.execute(perm_stmt)).scalars())
        missing = set(payload.permission_keys) - {p.key for p in permissions}
        if missing:
            raise ValidationError(f"Unknown permission keys: {sorted(missing)}")

    role.permissions = permissions
    await session.flush()
    return _to_read(role)
