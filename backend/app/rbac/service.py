"""Role and permission management."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit import service as audit
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.rbac.models import Permission, Role
from app.rbac.schemas import RoleCreate, RolePermissionsUpdate


def _snapshot(role: Role) -> dict[str, Any]:
    return {
        "name": role.name,
        "description": role.description,
        "permissions": sorted(p.key for p in role.permissions),
    }


async def list_roles(session: AsyncSession) -> list[Role]:
    stmt = select(Role).options(selectinload(Role.permissions)).order_by(Role.name)
    return list((await session.execute(stmt)).scalars())


async def list_permissions(session: AsyncSession) -> list[Permission]:
    stmt = select(Permission).order_by(Permission.key)
    return list((await session.execute(stmt)).scalars())


async def create_role(session: AsyncSession, payload: RoleCreate) -> Role:
    existing = (
        await session.execute(select(Role).where(Role.name == payload.name))
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("A role with this name already exists.")

    role = Role(name=payload.name, description=payload.description)
    session.add(role)
    await session.flush()
    await session.refresh(role, attribute_names=["permissions"])
    await audit.record(
        session, action="created", entity_type="role", entity_id=role.id, after=_snapshot(role)
    )
    return role


async def set_role_permissions(
    session: AsyncSession, role_id: int, payload: RolePermissionsUpdate
) -> Role:
    stmt = select(Role).where(Role.id == role_id).options(selectinload(Role.permissions))
    role = (await session.execute(stmt)).scalar_one_or_none()
    if role is None:
        raise NotFoundError(f"Role {role_id} not found.")
    before = _snapshot(role)

    permissions: list[Permission] = []
    if payload.permission_keys:
        perm_stmt = select(Permission).where(Permission.key.in_(payload.permission_keys))
        permissions = list((await session.execute(perm_stmt)).scalars())
        missing = set(payload.permission_keys) - {p.key for p in permissions}
        if missing:
            raise ValidationError(f"Unknown permission keys: {sorted(missing)}")

    role.permissions = permissions
    await session.flush()
    await audit.record(
        session,
        action="permissions_changed",
        entity_type="role",
        entity_id=role_id,
        before=before,
        after=_snapshot(role),
    )
    return role
