import { Navigate, type RouteObject } from 'react-router';

import {
  HomeRedirect,
  RequireAnyPermission,
  RequireAuth,
  RequirePermission,
} from '@/features/auth/guards';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AccessIndexRedirect, AccessPage } from '@/pages/admin/AccessPage';
import { AccountPage } from '@/pages/admin/AccountPage';
import { AdminHomePage } from '@/pages/admin/AdminHomePage';
import { AdminLayout } from '@/pages/admin/AdminLayout';
import { RolesPage } from '@/pages/admin/RolesPage';
import { UsersPage } from '@/pages/admin/UsersPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { PosHomePage } from '@/pages/pos/PosHomePage';
import { PosLayout } from '@/pages/pos/PosLayout';

/**
 * Two independent surfaces under one SPA: `/admin` and `/pos`, each gated by
 * a permission (`admin.access` / `pos.access`) behind `RequireAuth`. `/`
 * resolves onward by permission (`HomeRedirect`) rather than a fixed
 * target, since `RequirePermission` bounces a denied route back to `/`.
 *
 * Route access is a convenience for the user — the backend re-checks every
 * one of these permissions regardless (rule 11).
 */
export const routes: RouteObject[] = [
  { index: true, element: <HomeRedirect /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequirePermission permission="admin.access" />,
        children: [
          {
            path: '/admin',
            element: <AdminLayout />,
            children: [
              { index: true, element: <AdminHomePage /> },
              // No extra permission needed beyond admin.access — the
              // backend only ever touches the caller's own row here.
              { path: 'account', element: <AccountPage /> },
              // Old direct links from before "Usuarios"/"Roles" became one
              // section with tabs — kept working rather than 404ing.
              { path: 'users', element: <Navigate to="/admin/access/users" replace /> },
              { path: 'roles', element: <Navigate to="/admin/access/roles" replace /> },
              {
                path: 'access',
                // Gates the whole section: a MANAGER (users.manage only)
                // and an ADMIN (both) both get in; the tab-level
                // RequirePermission below decides what each can reach
                // inside it.
                element: <RequireAnyPermission permissions={['users.manage', 'roles.manage']} />,
                children: [
                  {
                    element: <AccessPage />,
                    children: [
                      { index: true, element: <AccessIndexRedirect /> },
                      {
                        element: <RequirePermission permission="users.manage" />,
                        children: [{ path: 'users', element: <UsersPage /> }],
                      },
                      {
                        element: <RequirePermission permission="roles.manage" />,
                        children: [{ path: 'roles', element: <RolesPage /> }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        element: <RequirePermission permission="pos.access" />,
        children: [
          {
            path: '/pos',
            element: <PosLayout />,
            children: [{ index: true, element: <PosHomePage /> }],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
