import { Navigate, type RouteObject } from 'react-router';

import {
  HomeRedirect,
  RequireAnyPermission,
  RequireAuth,
  RequirePermission,
  RequirePosAuth,
} from '@/features/auth/guards';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AccessIndexRedirect, AccessPage } from '@/pages/admin/AccessPage';
import { AccountPage } from '@/pages/admin/AccountPage';
import { AdminHomePage } from '@/pages/admin/AdminHomePage';
import { AdminLayout } from '@/pages/admin/AdminLayout';
import { AuditLogPage } from '@/pages/admin/AuditLogPage';
import { CatalogProductRedirect } from '@/pages/admin/CatalogProductRedirect';
import { CategoriesPage } from '@/pages/admin/CategoriesPage';
import { InventoryBalancesPage } from '@/pages/admin/InventoryBalancesPage';
import { InventoryIndexRedirect, InventoryPage } from '@/pages/admin/InventoryPage';
import { InventoryMovementsPage } from '@/pages/admin/InventoryMovementsPage';
import { InventoryWarehousesPage } from '@/pages/admin/InventoryWarehousesPage';
import { PosTerminalsPage } from '@/pages/admin/PosTerminalsPage';
import { LotsPage } from '@/pages/admin/LotsPage';
import { NotificationsPage } from '@/pages/admin/NotificationsPage';
import { OutboxPage } from '@/pages/admin/OutboxPage';
import { ProductDetailPage } from '@/pages/admin/ProductDetailPage';
import { ReportsPage } from '@/pages/admin/ReportsPage';
import { ReturnsPage } from '@/pages/admin/ReturnsPage';
import { SalesPage } from '@/pages/admin/SalesPage';
import { ZReportsPage } from '@/pages/admin/ZReportsPage';
import { SettingsPage } from '@/pages/admin/SettingsPage';
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
import { ForcedPasswordChangePage } from '@/pages/auth/ForcedPasswordChangePage';
import { PosHomePage } from '@/pages/pos/PosHomePage';
import { PosLayout } from '@/pages/pos/PosLayout';
import { PosLoginPage } from '@/pages/pos/PosLoginPage';
import { PosAuthProvider } from '@/features/auth/PosAuthProvider';

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
    path: '/pos/login',
    element: (
      <PosAuthProvider>
        <PosLoginPage />
      </PosAuthProvider>
    ),
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/change-password', element: <ForcedPasswordChangePage /> },
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
                // Productos, categorías, lotes y lo que antes vivía en
                // /admin/inventory, todo bajo un único apartado — pedido
                // explícito del usuario: "para mí un inventario es de
                // productos y donde se gestiona todo lo relacionado con
                // ellos", en vez de repartido en tres sitios del menú.
                path: 'inventory',
                element: (
                  <RequireAnyPermission
                    permissions={['product.read', 'lot.read', 'inventory.read']}
                  />
                ),
                children: [
                  {
                    element: <InventoryPage />,
                    children: [
                      { index: true, element: <InventoryIndexRedirect /> },
                      {
                        element: <RequirePermission permission="product.read" />,
                        children: [
                          { path: 'products', element: <ProductsPage /> },
                          { path: 'categories', element: <CategoriesPage /> },
                        ],
                      },
                      {
                        element: <RequirePermission permission="lot.read" />,
                        children: [{ path: 'lots', element: <LotsPage /> }],
                      },
                      {
                        element: <RequirePermission permission="inventory.read" />,
                        children: [
                          { path: 'balances', element: <InventoryBalancesPage /> },
                          { path: 'movements', element: <InventoryMovementsPage /> },
                          { path: 'warehouses', element: <InventoryWarehousesPage /> },
                        ],
                      },
                    ],
                  },
                  // Fuera del Outlet de InventoryPage a propósito — la
                  // ficha de un producto es su propia pantalla, no una
                  // pestaña más (ver ProductDetailPage).
                  { path: 'products/:productId', element: <ProductDetailPage /> },
                ],
              },
              // El terminal POS configura una caja, no las existencias: se
              // muestra en Configuración de la tienda. Conservamos la URL
              // antigua para los marcadores creados antes de moverlo.
              {
                path: 'inventory/terminals',
                element: <Navigate to="/admin/pos-terminals" replace />,
              },
              {
                path: 'pos-terminals',
                element: <RequirePermission permission="inventory.manage" />,
                children: [{ index: true, element: <PosTerminalsPage /> }],
              },
              // Enlaces viejos de antes de la reorganización — siguen
              // funcionando en vez de dar 404 (mismo criterio que
              // /admin/users, más abajo).
              { path: 'catalog', element: <Navigate to="/admin/inventory/products" replace /> },
              {
                path: 'catalog/products',
                element: <Navigate to="/admin/inventory/products" replace />,
              },
              {
                path: 'catalog/categories',
                element: <Navigate to="/admin/inventory/categories" replace />,
              },
              { path: 'catalog/products/:productId', element: <CatalogProductRedirect /> },
              { path: 'lots', element: <Navigate to="/admin/inventory/lots" replace /> },
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
                path: 'sales',
                element: <RequirePermission permission="sale.read" />,
                children: [{ index: true, element: <SalesPage /> }],
              },
              {
                path: 'z-reports',
                element: <RequirePermission permission="sale.read" />,
                children: [{ index: true, element: <ZReportsPage /> }],
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
              {
                path: 'reports',
                element: <RequirePermission permission="report.read" />,
                children: [{ index: true, element: <ReportsPage /> }],
              },
              {
                path: 'settings',
                element: <RequirePermission permission="settings.read" />,
                children: [{ index: true, element: <SettingsPage /> }],
              },
              {
                path: 'audit-log',
                element: <RequirePermission permission="audit.read" />,
                children: [{ index: true, element: <AuditLogPage /> }],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    element: (
      <PosAuthProvider>
        <RequirePosAuth />
      </PosAuthProvider>
    ),
    children: [
      {
        path: '/pos',
        element: <PosLayout />,
        children: [{ index: true, element: <PosHomePage /> }],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
