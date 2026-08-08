import { Navigate, type RouteObject } from 'react-router';

import { RequireAuth, RequirePermission } from '@/features/auth/guards';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AdminHomePage } from '@/pages/admin/AdminHomePage';
import { AdminLayout } from '@/pages/admin/AdminLayout';
import { LoginPage } from '@/pages/auth/LoginPage';
import { PosHomePage } from '@/pages/pos/PosHomePage';
import { PosLayout } from '@/pages/pos/PosLayout';

/**
 * Two independent surfaces under one SPA: `/admin` and `/pos`, each gated by
 * a permission (`admin.access` / `pos.access`) behind `RequireAuth`.
 *
 * Route access is a convenience for the user — the backend re-checks every
 * one of these permissions regardless (rule 11).
 */
export const routes: RouteObject[] = [
  { index: true, element: <Navigate to="/admin" replace /> },
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
            children: [{ index: true, element: <AdminHomePage /> }],
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
