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
  const userInitials = user?.full_name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  const roleLabel =
    user?.role === 'ADMIN' ? 'Administrador' : user?.role === 'MANAGER' ? 'Encargado' : user?.role;

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
    <div className="flex h-full min-h-0 bg-slate-100">
      <aside
        aria-label="Barra lateral"
        className="flex h-full w-60 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white lg:w-64"
      >
        <div className="shrink-0 border-b border-slate-100 px-5 py-5">
          <p className="truncate text-lg font-bold tracking-tight text-brand-700">{shopName}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">Administración de la tienda</p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
          <AdminNavigation
            hasPermission={hasPermission}
            isAdministrator={user?.role === 'ADMIN'}
            alertsCount={incidents.length}
            worstAlertSeverity={worst}
          />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 text-sm sm:px-6 lg:px-8">
          {user && (
            <NavLink
              to="/admin/account"
              aria-label={`Cuenta de ${user.full_name}`}
              className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700"
              >
                {userInitials}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate font-semibold text-slate-800 group-hover:text-brand-700">
                  {user.full_name}
                </span>
                <span className="block text-xs text-slate-500">{roleLabel}</span>
              </span>
            </NavLink>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg px-3 py-2 font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Cerrar sesión
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
