import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';

import { SEVERITY_STYLES, type Severity } from '@/features/notifications/api';

const linkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-2 ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`;

const navigationLinkClassName = (state: { isActive: boolean }) =>
  `${linkClassName(state)} min-w-0 flex-1`;

interface NavEntryDefinition {
  to: string;
  label: string;
  /** Se ve si el usuario tiene alguno de estos permisos. Vacío = siempre. */
  permissions: string[];
  children?: NavEntryDefinition[];
}

interface VisibleNavEntry extends NavEntryDefinition {
  canOpen: boolean;
  children: VisibleNavEntry[];
}

interface NavSection {
  title: string;
  entries: NavEntryDefinition[];
}

const OPERATION_SECTION: NavSection = {
  title: 'Operación',
  entries: [
    { to: '/admin', label: 'Inicio', permissions: [] },
    { to: '/admin/notifications', label: 'Avisos', permissions: ['notification.read'] },
    {
      to: '/admin/inventory',
      label: 'Inventario',
      permissions: ['product.read', 'lot.read', 'inventory.read'],
    },
    {
      to: '/admin/purchasing',
      label: 'Compras',
      permissions: ['purchase.read'],
      children: [{ to: '/admin/suppliers', label: 'Proveedores', permissions: ['supplier.read'] }],
    },
    {
      to: '/admin/sales',
      label: 'Ventas',
      permissions: ['sale.read'],
      children: [
        { to: '/admin/returns', label: 'Devoluciones', permissions: ['return.read'] },
        { to: '/admin/z-reports', label: 'Cierres de caja', permissions: ['sale.read'] },
      ],
    },
    { to: '/admin/reports', label: 'Informes', permissions: ['report.read'] },
  ],
};

const ADMINISTRATION_SECTION: NavSection = {
  title: 'Administración',
  entries: [
    {
      to: '/admin/settings',
      label: 'Configuración',
      permissions: ['settings.read'],
      children: [
        {
          to: '/admin/access',
          label: 'Usuarios y roles',
          permissions: ['users.manage', 'roles.manage'],
        },
        { to: '/admin/pricing', label: 'Precios e impuestos', permissions: ['pricing.manage'] },
        {
          to: '/admin/pos-terminals',
          label: 'Terminales POS',
          permissions: ['pos_terminal.manage'],
        },
        {
          to: '/admin/ticket-templates',
          label: 'Plantillas de ticket',
          permissions: ['ticket.manage'],
        },
        { to: '/admin/outbox', label: 'Correo', permissions: ['job.read'] },
        { to: '/admin/audit-log', label: 'Auditoría', permissions: ['audit.read'] },
      ],
    },
  ],
};

function visibleEntries(
  entries: NavEntryDefinition[],
  hasPermission: (permission: string) => boolean,
): VisibleNavEntry[] {
  return entries
    .map((entry) => {
      const children = visibleEntries(entry.children ?? [], hasPermission);
      const canOpen = entry.permissions.length === 0 || entry.permissions.some(hasPermission);
      return { ...entry, canOpen, children };
    })
    .filter((entry) => entry.canOpen || entry.children.length > 0);
}

function NavigationEntry({
  entry,
  alertsCount,
  worstAlertSeverity,
}: {
  entry: VisibleNavEntry;
  alertsCount: number;
  worstAlertSeverity: Severity | undefined;
}) {
  const location = useLocation();
  const [expanded, setExpanded] = useState(() => location.pathname.startsWith(entry.to));
  const hasChildren = entry.children.length > 0;
  const isAlerts = entry.to === '/admin/notifications';

  return (
    <div>
      <div className="flex items-center gap-1">
        {entry.canOpen ? (
          <NavLink to={entry.to} end={entry.to === '/admin'} className={navigationLinkClassName}>
            <span className="flex items-center justify-between gap-2">
              {entry.label}
              {isAlerts && worstAlertSeverity && (
                <span
                  aria-label={`${alertsCount} avisos sin resolver`}
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    SEVERITY_STYLES[worstAlertSeverity].badge
                  } ${SEVERITY_STYLES[worstAlertSeverity].blink ? 'animate-pulse' : ''}`}
                >
                  {alertsCount}
                </span>
              )}
            </span>
          </NavLink>
        ) : (
          <span className="min-w-0 flex-1 rounded px-3 py-2 font-medium text-slate-700">
            {entry.label}
          </span>
        )}
        {hasChildren && (
          <button
            type="button"
            aria-label={`${expanded ? 'Ocultar' : 'Mostrar'} opciones de ${entry.label}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="rounded px-2 py-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            {expanded ? '⌄' : '›'}
          </button>
        )}
      </div>
      {hasChildren && expanded && (
        <div className="ml-3 border-l border-slate-200 pl-2">
          {entry.children.map((child) => (
            <NavigationEntry
              key={child.to}
              entry={child}
              alertsCount={alertsCount}
              worstAlertSeverity={worstAlertSeverity}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Sidebar organized around store work, not backend modules. The ADMIN role
 * gets one additional configuration group; route and backend permission
 * guards remain authoritative for direct URLs and requests. */
export function AdminNavigation({
  hasPermission,
  isAdministrator,
  alertsCount,
  worstAlertSeverity,
}: {
  hasPermission: (permission: string) => boolean;
  isAdministrator: boolean;
  alertsCount: number;
  worstAlertSeverity: Severity | undefined;
}) {
  const sections = [OPERATION_SECTION, ...(isAdministrator ? [ADMINISTRATION_SECTION] : [])]
    .map((section) => ({ ...section, entries: visibleEntries(section.entries, hasPermission) }))
    .filter((section) => section.entries.length > 0);

  return (
    <nav
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 text-sm"
      aria-label="Navegación principal"
    >
      <div className="flex flex-col gap-1">
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-1">
            <p className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {section.title}
            </p>
            {section.entries.map((entry) => (
              <NavigationEntry
                key={entry.to}
                entry={entry}
                alertsCount={alertsCount}
                worstAlertSeverity={worstAlertSeverity}
              />
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
