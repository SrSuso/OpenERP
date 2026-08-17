import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';

import { useAuth } from '@/features/auth/useAuth';
import { SEVERITY_STYLES, incidentsQuery, type Severity } from '@/features/notifications/api';
import { useShopSetting } from '@/features/settings/useShopSettings';

const linkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-2 ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`;

interface NavEntry {
  to: string;
  label: string;
  /** Se ve si el usuario tiene *alguno* de estos permisos. Vacío = siempre. */
  permissions: string[];
}

interface NavSection {
  /** `null` para las entradas sueltas de arriba, que no llevan encabezado. */
  title: string | null;
  entries: NavEntry[];
}

/** El menú, por secciones: con 13 entradas seguidas costaba encontrar
 * dónde se cambia cada cosa. Agrupadas por para qué sirven, igual que
 * Inventario reunió en un sitio todo lo de productos.
 *
 * Declarado como datos y no como JSX suelto para que un encabezado nunca
 * quede huérfano: una sección cuyas entradas están todas ocultas por
 * permisos no se pinta. */
const SECTIONS: NavSection[] = [
  {
    title: null,
    entries: [
      { to: '/admin', label: 'Inicio', permissions: [] },
      {
        to: '/admin/inventory',
        label: 'Inventario',
        permissions: ['product.read', 'lot.read', 'inventory.read'],
      },
    ],
  },
  {
    title: 'Comprar y vender',
    entries: [
      { to: '/admin/suppliers', label: 'Proveedores', permissions: ['supplier.read'] },
      { to: '/admin/purchasing', label: 'Compras', permissions: ['purchase.read'] },
      { to: '/admin/sales', label: 'Ventas', permissions: ['sale.read'] },
      { to: '/admin/z-reports', label: 'Cierres de caja', permissions: ['sale.read'] },
      { to: '/admin/returns', label: 'Devoluciones', permissions: ['return.read'] },
      { to: '/admin/reports', label: 'Informes', permissions: ['report.read'] },
    ],
  },
  {
    title: 'Configuración de la tienda',
    entries: [
      { to: '/admin/settings', label: 'Configuración', permissions: ['settings.read'] },
      {
        to: '/admin/pos-terminals',
        label: 'Terminales POS',
        permissions: ['inventory.manage'],
      },
      { to: '/admin/pricing', label: 'Precios e impuestos', permissions: ['pricing.manage'] },
      {
        to: '/admin/ticket-templates',
        label: 'Plantillas de ticket',
        permissions: ['ticket.manage'],
      },
      { to: '/admin/notifications', label: 'Avisos', permissions: ['notification.read'] },
    ],
  },
  {
    title: 'Administración',
    entries: [
      {
        to: '/admin/access',
        label: 'Usuarios y roles',
        permissions: ['users.manage', 'roles.manage'],
      },
      { to: '/admin/audit-log', label: 'Auditoría', permissions: ['audit.read'] },
      { to: '/admin/outbox', label: 'Correo enviado', permissions: ['job.read'] },
      { to: '/admin/account', label: 'Mi cuenta', permissions: [] },
    ],
  },
];

/**
 * Shell for `/admin`. Nav entries are filtered by `hasPermission(...)` —
 * hiding a link is a convenience, the backend re-checks every one of them
 * regardless (rule 11), and `RequirePermission` on the matching route in
 * routes.tsx is the second line of defence if someone navigates there
 * directly.
 */
/** La más alta de las criticidades abiertas, para el contador del menú.
 * Ordenadas de menos a más: la última que aparezca gana. */
const SEVERITY_ORDER: Severity[] = ['LOW', 'MEDIUM_LOW', 'MEDIUM_HIGH', 'HIGH'];

export function AdminLayout() {
  const { user, hasPermission, logout } = useAuth();
  const shopName = useShopSetting('app.display_name', 'OpenERP');

  // Un aviso abierto tiene que verse desde cualquier pantalla, no sólo si
  // alguien entra en Avisos — es justo lo que hacía que se olvidaran.
  const canSeeIncidents = hasPermission('notification.read');
  const openIncidents = useQuery({
    ...incidentsQuery({ status: 'OPEN' }),
    enabled: canSeeIncidents,
    // El menú está siempre en pantalla: se refresca solo cada minuto para
    // que un aviso nuevo aparezca sin tener que recargar.
    refetchInterval: 60_000,
  });
  const incidents = openIncidents.data ?? [];
  const worst = SEVERITY_ORDER.filter((level) =>
    incidents.some((incident) => incident.severity === level),
  ).at(-1);

  const visible = SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter(
      (entry) => entry.permissions.length === 0 || entry.permissions.some(hasPermission),
    ),
  })).filter((section) => section.entries.length > 0);

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="mb-6 text-lg font-semibold text-brand-700">{shopName}</p>
        <nav className="flex flex-col gap-1 text-sm">
          {visible.map((section) => (
            <div key={section.title ?? 'principal'} className="flex flex-col gap-1">
              {section.title && (
                <p className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {section.title}
                </p>
              )}
              {section.entries.map((entry) => (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  end={entry.to === '/admin'}
                  className={linkClassName}
                >
                  <span className="flex items-center justify-between gap-2">
                    {entry.label}
                    {entry.to === '/admin/notifications' && worst && (
                      <span
                        aria-label={`${incidents.length} avisos sin resolver`}
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          SEVERITY_STYLES[worst].badge
                        } ${SEVERITY_STYLES[worst].blink ? 'animate-pulse' : ''}`}
                      >
                        {incidents.length}
                      </span>
                    )}
                  </span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col overflow-auto">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 px-8 py-3 text-sm text-slate-600">
          {user && (
            <span>
              {user.full_name} · <span className="text-slate-400">{user.role}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            className="font-medium text-brand-700 hover:underline"
          >
            Salir
          </button>
        </header>
        <main className="flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
