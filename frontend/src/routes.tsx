import { type RouteObject } from 'react-router';

import { HomeRedirect, RequireAuth, RequirePermission } from '@/features/auth/guards';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AdminHomePage } from '@/pages/admin/AdminHomePage';
import { AdminLayout } from '@/pages/admin/AdminLayout';
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
