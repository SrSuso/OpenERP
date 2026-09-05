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

# --- phase 8: lotes y caducidad -----------------------------------------------
LOT_READ = "lot.read"
LOT_MANAGE = "lot.manage"

PHASE_8_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(LOT_READ, "Look up lots, their balances and FEFO plans."),
    PermissionDef(LOT_MANAGE, "Create lots and record FEFO-ordered stock reductions."),
)

#: Frozen grants for the phase 8 migration only. CASHIER gets read access —
#: the POS (phase 12) will show expiration info — never manage.
PHASE_8_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (LOT_READ, LOT_MANAGE),
    "MANAGER": (LOT_READ, LOT_MANAGE),
    "CASHIER": (LOT_READ,),
}

# --- phase 9: recepciones -----------------------------------------------------
RECEIVING_READ = "receiving.read"
RECEIVING_MANAGE = "receiving.manage"

PHASE_9_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(RECEIVING_READ, "Look up goods receipts."),
    PermissionDef(RECEIVING_MANAGE, "Record goods receipts against purchase orders."),
)

#: Frozen grants for the phase 9 migration only.
PHASE_9_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (RECEIVING_READ, RECEIVING_MANAGE),
    "MANAGER": (RECEIVING_READ, RECEIVING_MANAGE),
}

# --- phase 10: categorías POS -------------------------------------------------
POS_CATEGORY_MANAGE = "pos_category.manage"

PHASE_10_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(POS_CATEGORY_MANAGE, "Create/edit POS button categories and assign products."),
)

#: Frozen grants for the phase 10 migration only. Reading POS categories
#: reuses ``product.read`` (already granted to CASHIER since phase 3) —
#: the POS grid (phase 12) only needs to look them up, never manage them.
PHASE_10_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (POS_CATEGORY_MANAGE,),
    "MANAGER": (POS_CATEGORY_MANAGE,),
}

# --- phase 11: ventas ---------------------------------------------------------
SALE_READ = "sale.read"
SALE_MANAGE = "sale.manage"

PHASE_11_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(SALE_READ, "Look up sales and their lines."),
    PermissionDef(SALE_MANAGE, "Open a sale, add/remove lines, cancel it."),
)

#: Frozen grants for the phase 11 migration only. Unlike every module
#: before it, CASHIER gets both — ringing up a sale is their job, not just
#: something they read.
PHASE_11_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (SALE_READ, SALE_MANAGE),
    "MANAGER": (SALE_READ, SALE_MANAGE),
    "CASHIER": (SALE_READ, SALE_MANAGE),
}

# --- phase 14: devoluciones ---------------------------------------------------
RETURN_READ = "return.read"
RETURN_MANAGE = "return.manage"

PHASE_14_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(RETURN_READ, "Look up returns and their lines."),
    PermissionDef(RETURN_MANAGE, "Process a return: refund, restock, or both."),
)

#: Frozen grants for the phase 14 migration only. Unlike sales, CASHIER
#: gets neither — reversing money/stock on an already-completed sale is a
#: supervisory action here, not the cashier's routine job.
PHASE_14_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (RETURN_READ, RETURN_MANAGE),
    "MANAGER": (RETURN_READ, RETURN_MANAGE),
}

# --- phase 15: tickets ---------------------------------------------------------
TICKET_MANAGE = "ticket.manage"

PHASE_15_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(TICKET_MANAGE, "Create and manage receipt (ticket) templates."),
)

#: Frozen grants for the phase 15 migration only. Generating/reading a
#: sale's own ticket reuses sale.read (phase 11) — only managing the
#: templates themselves is its own permission.
PHASE_15_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (TICKET_MANAGE,),
    "MANAGER": (TICKET_MANAGE,),
}

# --- phase 16: dashboards ------------------------------------------------------
DASHBOARD_READ = "dashboard.read"
DASHBOARD_MANAGE = "dashboard.manage"

PHASE_16_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(DASHBOARD_READ, "View dashboards and their live widget data."),
    PermissionDef(DASHBOARD_MANAGE, "Create dashboards and add/remove widgets."),
)

#: Frozen grants for the phase 16 migration only.
PHASE_16_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (DASHBOARD_READ, DASHBOARD_MANAGE),
    "MANAGER": (DASHBOARD_READ, DASHBOARD_MANAGE),
}

# --- phase 17: notificaciones ---------------------------------------------------
NOTIFICATION_READ = "notification.read"
NOTIFICATION_MANAGE = "notification.manage"

PHASE_17_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(NOTIFICATION_READ, "View notification rules and incidents."),
    PermissionDef(
        NOTIFICATION_MANAGE, "Create/edit notification rules, evaluate them, resolve incidents."
    ),
)

#: Frozen grants for the phase 17 migration only.
PHASE_17_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (NOTIFICATION_READ, NOTIFICATION_MANAGE),
    "MANAGER": (NOTIFICATION_READ, NOTIFICATION_MANAGE),
}

# --- phase 18: SMTP / outbox -------------------------------------------------
JOB_READ = "job.read"
JOB_MANAGE = "job.manage"

PHASE_18_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(JOB_READ, "View the outbox (queued/sent/failed emails)."),
    PermissionDef(JOB_MANAGE, "Manually trigger outbox processing."),
)

#: Frozen grants for the phase 18 migration only.
PHASE_18_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (JOB_READ, JOB_MANAGE),
    "MANAGER": (JOB_READ, JOB_MANAGE),
}

# --- phase 19: informes ---------------------------------------------------------
REPORT_READ = "report.read"
REPORT_MANAGE = "report.manage"

PHASE_19_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(REPORT_READ, "Run reports and view saved report definitions."),
    PermissionDef(REPORT_MANAGE, "Save and delete report definitions."),
)

#: Frozen grants for the phase 19 migration only. Back-office only, same
#: criterion as dashboards/purchasing — CASHIER has no reason to see this.
PHASE_19_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (REPORT_READ, REPORT_MANAGE),
    "MANAGER": (REPORT_READ, REPORT_MANAGE),
}

# --- phase 21: configuración del sistema ---------------------------------------
SETTINGS_READ = "settings.read"
SETTINGS_MANAGE = "settings.manage"

PHASE_21_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(SETTINGS_READ, "View functional store settings."),
    PermissionDef(SETTINGS_MANAGE, "Change functional store settings."),
)

#: Frozen grants for its original migration only. Infrastructure settings and
#: secrets never use these permissions: they are environment-only. The default
#: grant remains ADMIN-only for compatibility; custom roles can receive it.
PHASE_21_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (SETTINGS_READ, SETTINGS_MANAGE),
}

# --- phase 26: access to POS terminal administration -----------------------
POS_TERMINAL_MANAGE = "pos_terminal.manage"

PHASE_26_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(POS_TERMINAL_MANAGE, "Create and configure POS terminals."),
)

# Terminal configuration changes the physical cash-register setup and its
# behaviour. It is deliberately ADMIN-only by default; inventory management
# remains available to MANAGER without granting access to this surface.
PHASE_26_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (POS_TERMINAL_MANAGE,),
}

# --- phase 27: importe de bebida fría del TPV ------------------------------
#
# No reutilizamos ``settings.manage``: ese permiso abre todos los ajustes de
# negocio de la tienda. Este control permite delegar sólo el importe que la
# caja aplica al marcar una bebida como fría.
POS_COLD_DRINK_SURCHARGE_MANAGE = "pos.cold_drink_surcharge.manage"

PHASE_27_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(
        POS_COLD_DRINK_SURCHARGE_MANAGE,
        "View and change the POS cold-drink surcharge amount.",
    ),
)

# ADMIN conserva el acceso actual. Los demás roles, incluidos los creados por
# la tienda, lo pueden recibir expresamente desde Usuarios y roles.
PHASE_27_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (POS_COLD_DRINK_SURCHARGE_MANAGE,),
}

# --- phase 28: cierre Z definitivo ------------------------------------------
#
# El resumen X se puede consultar e imprimir durante la jornada con los
# permisos normales de venta. Emitir el documento Z final bloquea nuevas
# operaciones económicas para ese almacén y día, así que es una función de
# responsabilidad de gerente, no de la persona que cobra.
SALE_CLOSE_Z = "sale.close_z"

PHASE_28_PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef(SALE_CLOSE_Z, "Finalize the immutable daily Z cash report."),
)

PHASE_28_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    "ADMIN": (SALE_CLOSE_Z,),
    "MANAGER": (SALE_CLOSE_Z,),
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
    + PHASE_8_PERMISSIONS
    + PHASE_9_PERMISSIONS
    + PHASE_10_PERMISSIONS
    + PHASE_11_PERMISSIONS
    + PHASE_14_PERMISSIONS
    + PHASE_15_PERMISSIONS
    + PHASE_16_PERMISSIONS
    + PHASE_17_PERMISSIONS
    + PHASE_18_PERMISSIONS
    + PHASE_19_PERMISSIONS
    + PHASE_21_PERMISSIONS
    + PHASE_26_PERMISSIONS
    + PHASE_27_PERMISSIONS
    + PHASE_28_PERMISSIONS
)
