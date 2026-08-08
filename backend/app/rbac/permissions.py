"""Catalogue of permission keys known to the backend.

Every phase appends its own keys here (never renames or removes an existing
one — a role that already granted it must keep working). This module is the
single source of truth that :mod:`app.rbac.dependencies` compares requests
against.

Roles beyond ``ADMIN``/``MANAGER``/``CASHIER`` (and custom permission sets)
are created and edited at runtime through ``POST /roles`` and
``PATCH /roles/{id}/permissions`` — this module only fixes the vocabulary.

.. important::
    A migration must import ``PHASE_N_PERMISSIONS``/``PHASE_N_ROLE_GRANTS``
    for its own ``N`` — **never** the cumulative ``ALL_PERMISSIONS``. Python
    imports re-read the module's *current* state, so a migration seeded from
    a growing aggregate would, on a fresh database, insert permissions from
    phases that hadn't "happened" yet at that point in history — and the
    later phase's own migration would then fail inserting the same keys
    again. Each ``PHASE_N_*`` constant is frozen the moment phase ``N``
    ships; only ``ALL_PERMISSIONS`` (a read-only aggregate for runtime code,
    e.g. validating a key exists) grows.
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

#: Permission keys granted to each built-in role by the phase 1 migration.
#: Frozen — see the module docstring. Later phases add their own grants via
#: their own migration, referencing their own ``PHASE_N_ROLE_GRANTS``.
PHASE_1_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": tuple(p.key for p in PHASE_1_PERMISSIONS),
    "MANAGER": (ADMIN_ACCESS, USERS_MANAGE),
    "CASHIER": (POS_ACCESS,),
}

# --- phase 2: auditoría ------------------------------------------------------
AUDIT_READ = "audit.read"

PHASE_2_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(AUDIT_READ, "Read the audit trail."),
)

#: Frozen grants for the phase 2 migration only — ADMIN gets it, existing
#: roles are otherwise untouched (an operator can still widen MANAGER/CASHIER
#: from the roles API if they want to).
PHASE_2_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (AUDIT_READ,),
}

# --- phase 3: productos -----------------------------------------------------
PRODUCT_READ = "product.read"
PRODUCT_MANAGE = "product.manage"

PHASE_3_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(PRODUCT_READ, "Look up products, categories and packages."),
    PermissionDef(PRODUCT_MANAGE, "Create and edit products, categories and packages."),
)

#: Frozen grants for the phase 3 migration only. CASHIER gets read access —
#: the POS (phase 12) needs to look products up — never manage.
PHASE_3_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (PRODUCT_READ, PRODUCT_MANAGE),
    "MANAGER": (PRODUCT_READ, PRODUCT_MANAGE),
    "CASHIER": (PRODUCT_READ,),
}

# --- phase 4: precios --------------------------------------------------------
PRICING_MANAGE = "pricing.manage"

PHASE_4_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(PRICING_MANAGE, "Change cost/tax/margin/formula and set prices."),
)

#: Frozen grants for the phase 4 migration only. Previewing a formula and
#: reading price history only need product.read (already granted), so
#: pricing.manage is just the mutating half.
PHASE_4_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (PRICING_MANAGE,),
    "MANAGER": (PRICING_MANAGE,),
}

# --- phase 5: proveedores ----------------------------------------------------
SUPPLIER_READ = "supplier.read"
SUPPLIER_MANAGE = "supplier.manage"

PHASE_5_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(SUPPLIER_READ, "Look up suppliers and their product links."),
    PermissionDef(SUPPLIER_MANAGE, "Create/edit suppliers and link them to products."),
)

#: Frozen grants for the phase 5 migration only. CASHIER has no reason to
#: see supplier data.
PHASE_5_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (SUPPLIER_READ, SUPPLIER_MANAGE),
    "MANAGER": (SUPPLIER_READ, SUPPLIER_MANAGE),
}

# --- phase 6: compras --------------------------------------------------------
PURCHASE_READ = "purchase.read"
PURCHASE_MANAGE = "purchase.manage"

PHASE_6_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(PURCHASE_READ, "Look up purchase orders and a product's purchase history."),
    PermissionDef(PURCHASE_MANAGE, "Create, edit, place and cancel purchase orders."),
)

#: Frozen grants for the phase 6 migration only. CASHIER has no reason to
#: see purchasing data.
PHASE_6_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (PURCHASE_READ, PURCHASE_MANAGE),
    "MANAGER": (PURCHASE_READ, PURCHASE_MANAGE),
}

# --- phase 7: inventory ledger -----------------------------------------------
INVENTORY_READ = "inventory.read"
INVENTORY_MANAGE = "inventory.manage"

PHASE_7_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(INVENTORY_READ, "Look up stock movements and current balances."),
    PermissionDef(
        INVENTORY_MANAGE,
        "Record manual adjustments/transfers, manage warehouses, rebuild stock_balance.",
    ),
)

#: Frozen grants for the phase 7 migration only. CASHIER gets read access —
#: the POS (phase 12) needs to show stock — never manage.
PHASE_7_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (INVENTORY_READ, INVENTORY_MANAGE),
    "MANAGER": (INVENTORY_READ, INVENTORY_MANAGE),
    "CASHIER": (INVENTORY_READ,),
}

#: Every permission key known to the backend so far — for runtime use
#: (e.g. validating a key exists) only. Never import this from a migration;
#: see the module docstring.
ALL_PERMISSIONS: tuple[PermissionDef, ...] = (
    PHASE_1_PERMISSIONS
    + PHASE_2_PERMISSIONS
    + PHASE_3_PERMISSIONS
    + PHASE_4_PERMISSIONS
    + PHASE_5_PERMISSIONS
    + PHASE_6_PERMISSIONS
    + PHASE_7_PERMISSIONS
)
