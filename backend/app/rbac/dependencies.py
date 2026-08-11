"""Backend-enforced authorisation.

Every router that needs a permission check depends on
:func:`require_permission`; hiding a button in React is a convenience, never
the security boundary (rule 11).
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from app.auth.dependencies import CurrentUser
from app.core.errors import PermissionDeniedError
from app.users.models import User


def user_permissions(user: User) -> frozenset[str]:
    return frozenset(permission.key for permission in user.role.permissions)


def check_permission(user: User, key: str) -> None:
    """La misma comprobación que `require_permission`, para cuando el
    permiso que hace falta no se sabe hasta ver la petición — las fotos, por
    ejemplo, donde lo decide el tipo de dueño que venga en la URL (ver
    `app.catalog.images.IMAGE_OWNERS`). Una dependencia no puede saberlo a
    la hora de declararse, pero la comprobación sigue siendo del backend
    (regla 11)."""
    if key not in user_permissions(user):
        raise PermissionDeniedError(f"Missing permission: {key}")


def require_permission(key: str) -> Callable[[User], Coroutine[Any, Any, User]]:
    """Build a dependency that lets the request through only if the
    signed-in user's role grants ``key``; otherwise raises 403."""

    async def _check(user: CurrentUser) -> User:
        if key not in user_permissions(user):
            raise PermissionDeniedError(f"Missing permission: {key}")
        return user

    return _check


def require_any_permission(*keys: str) -> Callable[[User], Coroutine[Any, Any, User]]:
    """Like :func:`require_permission`, but lets the request through if the
    signed-in user's role grants *any one* of ``keys``.

    Used to widen a couple of read-only RBAC endpoints (``GET /roles``,
    ``GET /permissions``) beyond ``roles.manage`` alone: a MANAGER has
    ``users.manage`` but not ``roles.manage`` (phase 1's own grants), yet
    still needs to *read* the role catalogue to populate a role picker when
    creating a user from the admin panel. The write endpoints
    (``POST /roles``, ``PATCH /roles/{id}/permissions``) still require
    ``roles.manage`` alone — see app.rbac.router.
    """

    async def _check(user: CurrentUser) -> User:
        if user_permissions(user).isdisjoint(keys):
            raise PermissionDeniedError(f"Missing permission: one of {list(keys)}")
        return user

    return _check
