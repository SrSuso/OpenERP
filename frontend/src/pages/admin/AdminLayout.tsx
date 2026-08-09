import { NavLink, Outlet } from 'react-router';

import { useAuth } from '@/features/auth/AuthContext';

const linkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-2 ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`;

/**
 * Shell for `/admin`. Nav entries beyond "Inicio" are filtered by
 * `hasPermission(...)` — hiding a link is a convenience, the backend
 * re-checks every one of them regardless (rule 11), and `RequirePermission`
 * on the matching route in routes.tsx is the second line of defence if
 * someone navigates there directly.
 */
export function AdminLayout() {
  const { user, hasPermission, logout } = useAuth();

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="mb-6 text-lg font-semibold text-brand-700">OpenERP</p>
        <nav className="flex flex-col gap-1 text-sm">
          <NavLink to="/admin" end className={linkClassName}>
            Inicio
          </NavLink>
          {(hasPermission('product.read') ||
            hasPermission('lot.read') ||
            hasPermission('inventory.read')) && (
            <NavLink to="/admin/inventory" className={linkClassName}>
              Inventario
            </NavLink>
          )}
          {hasPermission('pricing.manage') && (
            <NavLink to="/admin/pricing" className={linkClassName}>
              Impuestos
            </NavLink>
          )}
          {hasPermission('supplier.read') && (
            <NavLink to="/admin/suppliers" className={linkClassName}>
              Proveedores
            </NavLink>
          )}
          {hasPermission('purchase.read') && (
            <NavLink to="/admin/purchasing" className={linkClassName}>
              Compras
            </NavLink>
          )}
          {hasPermission('return.read') && (
            <NavLink to="/admin/returns" className={linkClassName}>
              Devoluciones
            </NavLink>
          )}
          {hasPermission('ticket.manage') && (
            <NavLink to="/admin/ticket-templates" className={linkClassName}>
              Plantillas de ticket
            </NavLink>
          )}
          {hasPermission('notification.read') && (
            <NavLink to="/admin/notifications" className={linkClassName}>
              Notificaciones
            </NavLink>
          )}
          {hasPermission('job.read') && (
            <NavLink to="/admin/outbox" className={linkClassName}>
              Outbox / correo
            </NavLink>
          )}
          {(hasPermission('users.manage') || hasPermission('roles.manage')) && (
            <NavLink to="/admin/access" className={linkClassName}>
              Usuarios y roles
            </NavLink>
          )}
          <NavLink to="/admin/account" className={linkClassName}>
            Mi cuenta
          </NavLink>
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
