import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';

import { useAuth } from '@/features/auth/useAuth';
import { AdminNavigation } from '@/pages/admin/AdminNavigation';
import { incidentsQuery, type Severity } from '@/features/notifications/api';
import { useShopSetting } from '@/features/settings/useShopSettings';

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

  return (
    <div className="flex h-full">
      <aside className="flex h-full w-56 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white p-4">
        <p className="mb-6 shrink-0 text-lg font-semibold text-brand-700">{shopName}</p>
        <AdminNavigation
          hasPermission={hasPermission}
          isAdministrator={user?.role === 'ADMIN'}
          alertsCount={incidents.length}
          worstAlertSeverity={worst}
        />
      </aside>
      <div className="flex flex-1 flex-col overflow-auto">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 px-8 py-3 text-sm text-slate-600">
          {user && (
            <NavLink to="/admin/account" className="hover:text-brand-700 hover:underline">
              {user.full_name} · <span className="text-slate-400">{user.role}</span>
            </NavLink>
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
