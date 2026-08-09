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
import { CatalogPage } from '@/pages/admin/CatalogPage';
import { CategoriesPage } from '@/pages/admin/CategoriesPage';
import { InventoryBalancesPage } from '@/pages/admin/InventoryBalancesPage';
import { InventoryMovementsPage } from '@/pages/admin/InventoryMovementsPage';
import { InventoryPage } from '@/pages/admin/InventoryPage';
import { InventoryWarehousesPage } from '@/pages/admin/InventoryWarehousesPage';
import { LotsPage } from '@/pages/admin/LotsPage';
import { NotificationsPage } from '@/pages/admin/NotificationsPage';
import { OutboxPage } from '@/pages/admin/OutboxPage';
import { ReturnsPage } from '@/pages/admin/ReturnsPage';
import { TicketTemplatesPage } from '@/pages/admin/TicketTemplatesPage';
import { PricingFormulaPage } from '@/pages/admin/PricingFormulaPage';
import { PricingPage } from '@/pages/admin/PricingPage';
import { PricingTaxesPage } from '@/pages/admin/PricingTaxesPage';
import { ProductsPage } from '@/pages/admin/ProductsPage';
import { PurchasingPage } from '@/pages/admin/PurchasingPage';
import { RolesPage } from '@/pages/admin/RolesPage';
import { SuppliersPage } from '@/pages/admin/SuppliersPage';
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
              {
                path: 'catalog',
                element: <RequirePermission permission="product.read" />,
                children: [
                  {
                    element: <CatalogPage />,
                    children: [
                      { index: true, element: <Navigate to="products" replace /> },
                      { path: 'products', element: <ProductsPage /> },
                      { path: 'categories', element: <CategoriesPage /> },
                    ],
                  },
                ],
              },
              {
                path: 'pricing',
                element: <RequirePermission permission="pricing.manage" />,
                children: [
                  {
                    element: <PricingPage />,
                    children: [
                      { index: true, element: <Navigate to="taxes" replace /> },
                      { path: 'taxes', element: <PricingTaxesPage /> },
                      { path: 'formula', element: <PricingFormulaPage /> },
                    ],
                  },
                ],
              },
              {
                path: 'suppliers',
                element: <RequirePermission permission="supplier.read" />,
                children: [{ index: true, element: <SuppliersPage /> }],
              },
              {
                path: 'purchasing',
                element: <RequirePermission permission="purchase.read" />,
                children: [{ index: true, element: <PurchasingPage /> }],
              },
              {
                path: 'inventory',
                element: <RequirePermission permission="inventory.read" />,
                children: [
                  {
                    element: <InventoryPage />,
                    children: [
                      { index: true, element: <Navigate to="balances" replace /> },
                      { path: 'balances', element: <InventoryBalancesPage /> },
                      { path: 'movements', element: <InventoryMovementsPage /> },
                      { path: 'warehouses', element: <InventoryWarehousesPage /> },
                    ],
                  },
                ],
              },
              {
                path: 'lots',
                element: <RequirePermission permission="lot.read" />,
                children: [{ index: true, element: <LotsPage /> }],
              },
              {
                path: 'returns',
                element: <RequirePermission permission="return.read" />,
                children: [{ index: true, element: <ReturnsPage /> }],
              },
              {
                path: 'ticket-templates',
                element: <RequirePermission permission="ticket.manage" />,
                children: [{ index: true, element: <TicketTemplatesPage /> }],
              },
              {
                path: 'notifications',
                element: <RequirePermission permission="notification.read" />,
                children: [{ index: true, element: <NotificationsPage /> }],
              },
              {
                path: 'outbox',
                element: <RequirePermission permission="job.read" />,
                children: [{ index: true, element: <OutboxPage /> }],
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
