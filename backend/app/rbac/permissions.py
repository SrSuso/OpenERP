"""Catalogue of permission keys known to the backend.

Every phase appends its own keys here (never renames or removes an existing
one — a role that already granted it must keep working). This module is the
single source of truth that:

- :mod:`app.rbac.dependencies` compares requests against.
- the phase 1 migration seeds into the ``permissions`` table and grants to
  the built-in roles.

Roles beyond ``ADMIN``/``MANAGER``/``CASHIER`` (and custom permission sets)
are created and edited at runtime through ``POST /roles`` and
``PATCH /roles/{id}/permissions`` — this module only fixes the vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PermissionDef:
    key: str
    description: str


# --- phase 1: auth / rbac ---------------------------------------------------
ADMIN_ACCESS = "admin.access"
POS_ACCESS = "pos.access"
USERS_MANAGE = "users.manage"
ROLES_MANAGE = "roles.manage"

PHASE_1_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(ADMIN_ACCESS, "Enter the administration panel."),
    PermissionDef(POS_ACCESS, "Enter the point of sale."),
    PermissionDef(USERS_MANAGE, "Create, edit and deactivate user accounts."),
    PermissionDef(ROLES_MANAGE, "Create roles and assign permissions to them."),
)

#: Every permission key known to the backend so far. Later phases extend this
#: tuple with their own ``PHASE_N_PERMISSIONS`` — never mutate the ones above.
ALL_PERMISSIONS: tuple[PermissionDef, ...] = PHASE_1_PERMISSIONS

#: Permission keys granted to each built-in role, seeded by the phase 1
#: migration. ``ADMIN`` always gets everything; ``MANAGER``/``CASHIER`` are a
#: sane starting point an operator can widen or narrow from the roles API.
ROLE_SEED: dict[str, tuple[str, ...]] = {
    "ADMIN": tuple(p.key for p in ALL_PERMISSIONS),
    "MANAGER": (ADMIN_ACCESS, USERS_MANAGE),
    "CASHIER": (POS_ACCESS,),
}
