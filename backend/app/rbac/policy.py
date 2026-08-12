"""Small, capability-based rules shared by users and role management."""

from __future__ import annotations

from app.core.errors import PermissionDeniedError
from app.rbac.dependencies import user_permissions
from app.rbac.models import Role
from app.users.models import User


def role_permissions(role: Role) -> frozenset[str]:
    return frozenset(permission.key for permission in role.permissions)


def ensure_role_is_assignable(actor: User, role: Role) -> None:
    """Reject granting any permission which the acting user does not hold."""
    missing = role_permissions(role) - user_permissions(actor)
    if missing:
        raise PermissionDeniedError(
            "You cannot assign a role containing permissions you do not have."
        )


def ensure_permissions_are_grantable(actor: User, permission_keys: set[str]) -> None:
    """Apply the same no-escalation rule when editing a role directly."""
    if permission_keys - user_permissions(actor):
        raise PermissionDeniedError("You cannot grant permissions you do not have.")
