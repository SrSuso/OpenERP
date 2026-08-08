"""Role and permission management. Everything here needs ``roles.manage``."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep
from app.rbac import service
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


def _permission_to_read(permission: Permission) -> PermissionRead:
    return PermissionRead(id=permission.id, key=permission.key, description=permission.description)


@router.get("/roles", response_model=list[RoleRead])
async def list_roles(session: SessionDep) -> list[RoleRead]:
    return [_to_read(r) for r in await service.list_roles(session)]


@router.get("/permissions", response_model=list[PermissionRead])
async def list_permissions(session: SessionDep) -> list[PermissionRead]:
    return [_permission_to_read(p) for p in await service.list_permissions(session)]


@router.post("/roles", response_model=RoleRead, status_code=201)
async def create_role(payload: RoleCreate, session: SessionDep) -> RoleRead:
    return _to_read(await service.create_role(session, payload))


@router.patch("/roles/{role_id}/permissions", response_model=RoleRead)
async def set_role_permissions(
    role_id: int, payload: RolePermissionsUpdate, session: SessionDep
) -> RoleRead:
    return _to_read(await service.set_role_permissions(session, role_id, payload))
