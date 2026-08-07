import { NavLink, Outlet } from 'react-router';

/**
 * Shell for `/admin`.
 *
 * Phase 1 replaces the static nav with one filtered by the signed-in user's
 * permissions — and the backend re-checks every one of them regardless.
 */
export function AdminLayout() {
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
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
