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


def require_permission(key: str) -> Callable[[User], Coroutine[Any, Any, User]]:
    """Build a dependency that lets the request through only if the
    signed-in user's role grants ``key``; otherwise raises 403."""

    async def _check(user: CurrentUser) -> User:
        if key not in user_permissions(user):
            raise PermissionDeniedError(f"Missing permission: {key}")
        return user

    return _check
