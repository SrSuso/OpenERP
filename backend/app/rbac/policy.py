"""Small, capability-based rules shared by users and role management."""

from __future__ import annotations

from sqlalchemy import Select, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, PermissionDeniedError
from app.rbac.dependencies import user_permissions
from app.rbac.models import Permission, Role
from app.rbac.models import role_permissions as role_permissions_table
from app.rbac.permissions import ALL_PERMISSIONS
from app.users.models import User

# With the no-grant-above-yourself rule, a permission absent from every active
# administrator cannot be granted back.  Recovery therefore requires the full
# runtime catalogue.  This remains capability-based: a custom full-access role
# qualifies and the literal name "ADMIN" has no special power.
RECOVERABLE_ADMIN_PERMISSIONS = frozenset(permission.key for permission in ALL_PERMISSIONS)

# Serialises only mutations which can reduce the set above.  This is not a
# general business-operation lock (A2); it protects one installation-wide
# security invariant for which there is no singleton row to lock.
_RECOVERABLE_ADMIN_LOCK_KEY = 5_289_817_125_909_153_107


def role_permissions(role: Role) -> frozenset[str]:
    return frozenset(permission.key for permission in role.permissions)


def ensure_role_is_assignable(actor: User, role: Role) -> None:
    """Reject granting any permission which the acting user does not hold."""
    missing = role_permissions(role) - user_permissions(actor)
    if missing:
        raise PermissionDeniedError(
            "You cannot assign a role containing permissions you do not have."
        )


def ensure_user_is_manageable(actor: User, user: User) -> None:
    """Keep account lifecycle operations within the actor's capability set."""
    if role_permissions(user.role) - user_permissions(actor):
        raise PermissionDeniedError(
            "You cannot administer an account containing permissions you do not have."
        )


def ensure_permissions_are_grantable(actor: User, permission_keys: set[str]) -> None:
    """Apply the same no-escalation rule when editing a role directly."""
    if permission_keys - user_permissions(actor):
        raise PermissionDeniedError("You cannot grant permissions you do not have.")


def is_recoverable_role(permission_keys: set[str] | frozenset[str]) -> bool:
    return permission_keys >= RECOVERABLE_ADMIN_PERMISSIONS


async def lock_recoverable_admin_invariant(session: AsyncSession) -> None:
    """Take the transaction-scoped PostgreSQL lock for admin availability."""
    await session.execute(select(func.pg_advisory_xact_lock(_RECOVERABLE_ADMIN_LOCK_KEY)))


def _recoverable_role_ids() -> Select[tuple[int]]:
    return (
        select(role_permissions_table.c.role_id)
        .join(Permission, Permission.id == role_permissions_table.c.permission_id)
        .where(Permission.key.in_(RECOVERABLE_ADMIN_PERMISSIONS))
        .group_by(role_permissions_table.c.role_id)
        .having(func.count(distinct(Permission.key)) == len(RECOVERABLE_ADMIN_PERMISSIONS))
    )


async def _active_recoverable_count(
    session: AsyncSession,
    *,
    excluding_user_id: int | None = None,
    excluding_role_id: int | None = None,
) -> int:
    stmt = select(func.count(User.id)).where(
        User.is_active.is_(True), User.role_id.in_(_recoverable_role_ids())
    )
    if excluding_user_id is not None:
        stmt = stmt.where(User.id != excluding_user_id)
    if excluding_role_id is not None:
        stmt = stmt.where(User.role_id != excluding_role_id)
    return int((await session.execute(stmt)).scalar_one())


def _raise_last_admin_conflict() -> None:
    raise ConflictError(
        "The operation would leave the installation without an active recoverable administrator."
    )


async def ensure_user_transition_preserves_recovery(
    session: AsyncSession, *, user: User, role: Role, is_active: bool
) -> None:
    """Validate a proposed user state while the invariant lock is held."""
    was_recoverable = user.is_active and is_recoverable_role(role_permissions(user.role))
    will_be_recoverable = is_active and is_recoverable_role(role_permissions(role))
    if not was_recoverable or will_be_recoverable:
        return
    if await _active_recoverable_count(session, excluding_user_id=user.id) == 0:
        _raise_last_admin_conflict()


async def ensure_role_transition_preserves_recovery(
    session: AsyncSession, *, role: Role, permission_keys: set[str]
) -> None:
    """Validate replacing a role's grants while the invariant lock is held."""
    if not is_recoverable_role(role_permissions(role)) or is_recoverable_role(permission_keys):
        return
    if await _active_recoverable_count(session, excluding_role_id=role.id) == 0:
        _raise_last_admin_conflict()
