import { Navigate, type RouteObject } from 'react-router';

import { NotFoundPage } from '@/pages/NotFoundPage';
import { AdminHomePage } from '@/pages/admin/AdminHomePage';
import { AdminLayout } from '@/pages/admin/AdminLayout';
import { PosHomePage } from '@/pages/pos/PosHomePage';
import { PosLayout } from '@/pages/pos/PosLayout';

/**
 * Two independent surfaces under one SPA: `/admin` and `/pos`.
 *
 * Route access is enforced in phase 1 with permission-aware guards; hiding a
 * route is a convenience for the user, never the security boundary.
 */
export const routes: RouteObject[] = [
  { index: true, element: <Navigate to="/admin" replace /> },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [{ index: true, element: <AdminHomePage /> }],
  },
  {
    path: '/pos',
    element: <PosLayout />,
    children: [{ index: true, element: <PosHomePage /> }],
  },
  { path: '*', element: <NotFoundPage /> },
];
