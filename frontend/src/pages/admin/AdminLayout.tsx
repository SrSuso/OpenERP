import { NavLink, Outlet } from 'react-router';

import { useAuth } from '@/features/auth/AuthContext';

/**
 * Shell for `/admin`.
 *
 * The nav below is intentionally minimal in phase 1 (just "Inicio"); later
 * phases add entries filtered by `hasPermission(...)` — the backend
 * re-checks every one of them regardless.
 */
export function AdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="mb-6 text-lg font-semibold text-brand-700">OpenERP</p>
        <nav className="flex flex-col gap-1 text-sm">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `rounded px-3 py-2 ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`
            }
          >
            Inicio
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
