import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from '@/features/auth/AuthContext';
import { useBaseFontSize } from '@/features/settings/useBaseFontSize';
import { useButtonColors } from '@/features/settings/useButtonColors';

/**
 * Redirects to `/login` when signed out; renders nothing while the initial
 * `/auth/me` call is in flight, to avoid a flash of the login page for an
 * already-authenticated visitor.
 *
 * Convenience only — hiding a route is not the security boundary, the
 * backend rejects the request either way (rule 11).
 */
export function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  // Aquí y no más abajo: es el único punto por el que pasan tanto el panel
  // como la caja, y el primero en el que ya hay sesión para poder leer los
  // ajustes de la tienda.
  useBaseFontSize();
  useButtonColors();

  if (isLoading) {
    return null;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/**
 * Nested under `RequireAuth`: also requires `permission`. The visitor *is*
 * signed in, just not allowed here, so this bounces to `/` — resolved by
 * `HomeRedirect` below — instead of back to the login screen.
 */
export function RequirePermission({ permission }: { permission: string }) {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

/**
 * Like `RequirePermission`, but passes if the visitor has *any one* of
 * `permissions` — for a route that has more than one legitimate way in
 * (e.g. `/admin/access`: a MANAGER only has `users.manage`, an ADMIN has
 * both, but either is enough to see the section at all). Which sub-tab
 * actually renders once inside is still each tab's own `RequirePermission`
 * — this only gates the shared shell.
 */
export function RequireAnyPermission({ permissions }: { permissions: string[] }) {
  const { hasPermission } = useAuth();

  if (!permissions.some((permission) => hasPermission(permission))) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

/**
 * The `/` index route: sends the visitor to whichever surface their
 * permissions actually grant, in order of precedence.
 *
 * Must not hardcode a target (e.g. always `/admin`) — `RequirePermission`
 * bounces here on a denied route, and a fixed target would loop the two
 * against each other forever for a cashier hitting `/admin`.
 */
export function HomeRedirect() {
  const { isLoading, hasPermission, user } = useAuth();

  if (isLoading) {
    return null;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (hasPermission('admin.access')) {
    return <Navigate to="/admin" replace />;
  }
  if (hasPermission('pos.access')) {
    return <Navigate to="/pos" replace />;
  }
  // Signed in, but their role grants neither surface — nothing to send them
  // to yet. Falls back to the login screen rather than looping.
  return <Navigate to="/login" replace />;
}
