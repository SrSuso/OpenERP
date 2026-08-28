import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router';

type NavigationIconName =
  'home' | 'alerts' | 'inventory' | 'purchasing' | 'sales' | 'reports' | 'settings';

interface NavEntryDefinition {
  to: string;
  label: string;
  /** Se ve si el usuario tiene alguno de estos permisos. Vacío = siempre. */
  permissions: string[];
  icon?: NavigationIconName;
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
    { to: '/admin', label: 'Inicio', permissions: [], icon: 'home' },
    {
      to: '/admin/notifications',
      label: 'Avisos',
      permissions: ['notification.read'],
      icon: 'alerts',
    },
    {
      to: '/admin/inventory',
      label: 'Inventario',
      permissions: ['product.read', 'lot.read', 'inventory.read'],
      icon: 'inventory',
    },
    {
      to: '/admin/purchasing',
      label: 'Compras',
      permissions: ['purchase.read'],
      icon: 'purchasing',
      children: [{ to: '/admin/suppliers', label: 'Proveedores', permissions: ['supplier.read'] }],
    },
    {
      to: '/admin/sales',
      label: 'Ventas',
      permissions: ['sale.read'],
      icon: 'sales',
      children: [
        { to: '/admin/returns', label: 'Devoluciones', permissions: ['return.read'] },
        { to: '/admin/z-reports', label: 'Cierres de caja', permissions: ['sale.read'] },
      ],
    },
    { to: '/admin/reports', label: 'Informes', permissions: ['report.read'], icon: 'reports' },
  ],
};

const ADMINISTRATION_SECTION: NavSection = {
  title: 'Administración',
  entries: [
    {
      to: '/admin/settings',
      label: 'Configuración',
      permissions: ['settings.read'],
      icon: 'settings',
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

function entryContainsPath(entry: VisibleNavEntry, pathname: string): boolean {
  if (entry.to === '/admin') return pathname === entry.to;
  if (pathname === entry.to || pathname.startsWith(`${entry.to}/`)) return true;
  return entry.children.some((child) => entryContainsPath(child, pathname));
}

function NavigationIcon({ name }: { name: NavigationIconName }) {
  const paths: Record<NavigationIconName, ReactNode> = {
    home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />,
    alerts: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    inventory: (
      <>
        <path d="m12 2 9 5-9 5-9-5Z" />
        <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
      </>
    ),
    purchasing: (
      <>
        <path d="M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L21 7H6" />
        <circle cx="10" cy="20" r="1" />
        <circle cx="18" cy="20" r="1" />
      </>
    ),
    sales: (
      <>
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z" />
        <path d="M9 7h6M9 11h6M9 15h3" />
      </>
    ),
    reports: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 shrink-0"
    >
      {paths[name]}
    </svg>
  );
}

function NavigationEntry({ entry, alertsCount }: { entry: VisibleNavEntry; alertsCount: number }) {
  const location = useLocation();
  const [expanded, setExpanded] = useState(() => location.pathname.startsWith(entry.to));
  const hasChildren = entry.children.length > 0;
  const isAlerts = entry.to === '/admin/notifications';
  const isNested = entry.icon === undefined;
  const containsCurrentPath = entryContainsPath(entry, location.pathname);
  const showChildren = hasChildren && expanded;

  useEffect(() => {
    if (hasChildren && containsCurrentPath) setExpanded(true);
  }, [containsCurrentPath, hasChildren]);

  const linkClassName = ({ isActive }: { isActive: boolean }) =>
    `group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
      isActive || containsCurrentPath
        ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100'
        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
    } ${isNested ? 'py-2 pl-3' : ''}`;

  return (
    <div>
      <div className="flex items-center gap-1">
        {entry.canOpen ? (
          <NavLink to={entry.to} end={entry.to === '/admin'} className={linkClassName}>
            {entry.icon && <NavigationIcon name={entry.icon} />}
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="truncate">{entry.label}</span>
              {isAlerts && alertsCount > 0 && (
                <span
                  aria-label={`${alertsCount} avisos sin resolver`}
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
                >
                  {alertsCount}
                </span>
              )}
            </span>
          </NavLink>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-slate-700">
            {entry.icon && <NavigationIcon name={entry.icon} />}
            {entry.label}
          </span>
        )}
        {hasChildren && (
          <button
            type="button"
            aria-label={`${showChildren ? 'Ocultar' : 'Mostrar'} opciones de ${entry.label}`}
            aria-expanded={showChildren}
            onClick={() => setExpanded((current) => !current)}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`size-4 transition-transform ${showChildren ? 'rotate-90' : ''}`}
            >
              <path d="m7 5 5 5-5 5Z" />
            </svg>
          </button>
        )}
      </div>
      {showChildren && (
        <div className="ml-5 mt-1 border-l border-slate-200 pl-2">
          {entry.children.map((child) => (
            <NavigationEntry key={child.to} entry={child} alertsCount={alertsCount} />
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
}: {
  hasPermission: (permission: string) => boolean;
  isAdministrator: boolean;
  alertsCount: number;
}) {
  const sections = [OPERATION_SECTION, ...(isAdministrator ? [ADMINISTRATION_SECTION] : [])]
    .map((section) => ({ ...section, entries: visibleEntries(section.entries, hasPermission) }))
    .filter((section) => section.entries.length > 0);

  return (
    <nav
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 text-sm"
      aria-label="Navegación principal"
    >
      <div className="flex flex-col gap-5">
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-1">
            <p className="mb-1 px-3 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-slate-500">
              {section.title}
            </p>
            {section.entries.map((entry) => (
              <NavigationEntry key={entry.to} entry={entry} alertsCount={alertsCount} />
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
