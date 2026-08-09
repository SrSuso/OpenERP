import { NavLink, Navigate, Outlet } from 'react-router';

import { useAuth } from '@/features/auth/AuthContext';

const tabClassName = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-4 py-2 text-sm font-medium ${
    isActive
      ? 'border-brand-700 text-brand-700'
      : 'border-transparent text-slate-500 hover:text-slate-700'
  }`;

/** `/admin/access` — one section, two tabs (Usuarios / Roles), each still
 * behind its own `RequirePermission` in routes.tsx (rule 11: hiding a tab
 * here is a convenience, not the boundary). A tab only shows if the
 * visitor could actually use it — a MANAGER (users.manage, no
 * roles.manage) sees just "Usuarios". */
export function AccessPage() {
  const { hasPermission } = useAuth();

  return (
    <section>
      <nav className="mb-6 flex gap-2 border-b border-slate-200" aria-label="Usuarios y roles">
        {hasPermission('users.manage') && (
          <NavLink to="users" className={tabClassName}>
            Usuarios
          </NavLink>
        )}
        {hasPermission('roles.manage') && (
          <NavLink to="roles" className={tabClassName}>
            Roles
          </NavLink>
        )}
      </nav>
      <Outlet />
    </section>
  );
}

/** `/admin/access` itself (the index route) has nothing to show — send the
 * visitor straight to whichever tab their permissions actually grant, in
 * order of precedence. Mirrors `HomeRedirect`'s own reasoning. */
export function AccessIndexRedirect() {
  const { hasPermission } = useAuth();

  if (hasPermission('users.manage')) {
    return <Navigate to="users" replace />;
  }
  if (hasPermission('roles.manage')) {
    return <Navigate to="roles" replace />;
  }
  // Unreachable in practice — RequireAnyPermission on the parent route
  // already keeps anyone with neither permission from getting here.
  return <Navigate to="/admin" replace />;
}
