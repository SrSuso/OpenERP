import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from '@/features/auth/AuthContext';

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
 * signed in, just not allowed here, so this bounces to `/` (which resolves
 * onward by role) instead of back to the login screen.
 */
export function RequirePermission({ permission }: { permission: string }) {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
