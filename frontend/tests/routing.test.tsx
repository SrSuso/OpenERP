// @vitest-environment happy-dom
//
// jsdom's own AbortController/AbortSignal shadow Node's native ones, and
// React Router's data-router navigation (createMemoryRouter → any redirect,
// including our RequireAuth/RequirePermission guards) constructs an
// internal Request carrying an AbortSignal — which Node's built-in
// fetch/undici then rejects as "not an instance of AbortSignal". Confirmed
// upstream bug, fixed in vitest 4 (currently beta):
// https://github.com/vitest-dev/vitest/issues/8374
// happy-dom doesn't shadow those globals, so this file alone opts out of
// jsdom (the project default, used everywhere else) until vitest 4 ships.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { routes } from '@/routes';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const HEALTH_OK = { status: 'ok', app: 'OpenERP', environment: 'test' };

const HEALTH_DOWN_ENVELOPE = {
  error: { code: 'service_unavailable', message: 'Database is not reachable.' },
  request_id: 'req-1',
};

const UNAUTHENTICATED_ENVELOPE = {
  error: { code: 'unauthenticated', message: 'Not authenticated.' },
  request_id: 'req-me',
};

function meBody(role: 'ADMIN' | 'CASHIER', permissions?: string[]): unknown {
  return {
    id: 1,
    email: 'test@example.com',
    full_name: 'Test User',
    role,
    permissions:
      permissions ?? (role === 'ADMIN' ? ['admin.access', 'pos.access'] : ['pos.access']),
  };
}

/**
 * Every request goes through here so each test states, up front, exactly
 * what the signed-in user (if any) and the health check look like — routes
 * now depend on `/auth/me` (phase 1), not just `/health/live` (phase 0).
 */
function stubFetch(options: {
  me: 'admin' | 'cashier' | 'signed-out';
  health?: 'ok' | 'down';
  permissions?: string[];
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('/auth/me')) {
        if (options.me === 'signed-out') {
          return Promise.resolve(jsonResponse(UNAUTHENTICATED_ENVELOPE, { status: 401 }));
        }
        return Promise.resolve(
          jsonResponse(meBody(options.me === 'admin' ? 'ADMIN' : 'CASHIER', options.permissions)),
        );
      }

      if (url.includes('/health/live')) {
        return Promise.resolve(
          options.health === 'down'
            ? jsonResponse(HEALTH_DOWN_ENVELOPE, { status: 503 })
            : jsonResponse(HEALTH_OK),
        );
      }

      // /admin/access, /admin/catalog and /admin/pricing's tabs (only
      // reached in the tests that navigate there) fetch their own lists on
      // mount — empty is enough to get past the loading state and check
      // what rendered. /pricing/settings isn't a list, so it gets its own
      // shape below.
      if (url.includes('/pricing/settings')) {
        return Promise.resolve(jsonResponse({ formula: 'cost' }));
      }
      if (
        url.endsWith('/users') ||
        url.endsWith('/roles') ||
        url.endsWith('/permissions') ||
        url.includes('/product-categories') ||
        url.includes('/pos-categories') ||
        url.includes('/products?') ||
        url.includes('/units') ||
        url.includes('/taxes')
      ) {
        return Promise.resolve(jsonResponse([]));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${url} in test`));
    }),
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('routing', () => {
  it('renders the admin panel at /admin for a signed-in admin', async () => {
    stubFetch({ me: 'admin', health: 'ok' });

    renderAt('/admin');

    expect(
      await screen.findByRole('heading', { name: /panel de administración/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('api-status')).toHaveTextContent('ok · OpenERP · test'),
    );
  });

  it('redirects to /login when signed out', async () => {
    stubFetch({ me: 'signed-out' });

    renderAt('/admin');

    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
  });

  it('sends a cashier trying /admin to their own home instead of /login', async () => {
    stubFetch({ me: 'cashier' });

    renderAt('/admin');

    expect(await screen.findByRole('heading', { name: /punto de venta/i })).toBeInTheDocument();
  });

  it('renders the POS at /pos for a signed-in cashier', async () => {
    stubFetch({ me: 'cashier' });

    renderAt('/pos');

    expect(await screen.findByRole('heading', { name: /punto de venta/i })).toBeInTheDocument();
  });

  it('does not render the admin shell inside the POS', async () => {
    stubFetch({ me: 'cashier' });

    renderAt('/pos');

    await screen.findByRole('heading', { name: /punto de venta/i });
    expect(screen.queryByRole('link', { name: /inicio/i })).not.toBeInTheDocument();
  });

  it('redirects the root path to the admin panel for a signed-in admin', async () => {
    stubFetch({ me: 'admin', health: 'ok' });

    renderAt('/');

    expect(
      await screen.findByRole('heading', { name: /panel de administración/i }),
    ).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown route', async () => {
    stubFetch({ me: 'signed-out' });

    renderAt('/nope');

    expect(
      await screen.findByRole('heading', { name: /página no encontrada/i }),
    ).toBeInTheDocument();
  });

  it('surfaces an API failure instead of hanging on the loading state', async () => {
    stubFetch({ me: 'admin', health: 'down' });

    renderAt('/admin');

    await waitFor(() =>
      expect(screen.getByTestId('api-status')).toHaveTextContent(/sin conexión/i),
    );
  });

  it('bounces an admin without users.manage away from /admin/users', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access', 'pos.access'] });

    renderAt('/admin/users');

    // RequirePermission sends it to `/`, which resolves back to /admin's
    // own index for this admin.access user (HomeRedirect) — never /login.
    expect(
      await screen.findByRole('heading', { name: /panel de administración/i }),
    ).toBeInTheDocument();
  });

  it('lets a MANAGER (users.manage, no roles.manage) into /admin/users', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access', 'users.manage'] });

    renderAt('/admin/users');

    expect(await screen.findByRole('heading', { name: /^usuarios$/i })).toBeInTheDocument();
  });

  it('bounces a MANAGER without roles.manage away from /admin/roles', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access', 'users.manage'] });

    renderAt('/admin/roles');

    expect(
      await screen.findByRole('heading', { name: /panel de administración/i }),
    ).toBeInTheDocument();
  });

  it('lets an ADMIN (roles.manage) into /admin/roles', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access', 'roles.manage'] });

    renderAt('/admin/roles');

    expect(await screen.findByRole('heading', { name: /^roles$/i })).toBeInTheDocument();
  });

  it('sends a MANAGER hitting /admin/access straight to the Usuarios tab, with no Roles tab shown', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access', 'users.manage'] });

    renderAt('/admin/access');

    expect(await screen.findByRole('heading', { name: /^usuarios$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
  });

  it('shows both tabs to an ADMIN and switches on click', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access', 'users.manage', 'roles.manage'] });

    renderAt('/admin/access');

    await screen.findByRole('heading', { name: /^usuarios$/i });
    const rolesTab = screen.getByRole('link', { name: 'Roles' });

    await userEvent.click(rolesTab);

    expect(await screen.findByRole('heading', { name: /^roles$/i })).toBeInTheDocument();
  });

  it('bounces an admin with neither users.manage nor roles.manage away from /admin/access', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access', 'pos.access'] });

    renderAt('/admin/access');

    expect(
      await screen.findByRole('heading', { name: /panel de administración/i }),
    ).toBeInTheDocument();
  });

  it('sends /admin/catalog straight to the Productos tab for a user with product.read', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access', 'product.read'] });

    renderAt('/admin/catalog');

    // No product.manage: view-only, "Nuevo producto" never appears.
    await screen.findByRole('link', { name: 'Categorías' });
    expect(screen.getByRole('link', { name: 'Productos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).not.toBeInTheDocument();
  });

  it('bounces a user without product.read away from /admin/catalog', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access'] });

    renderAt('/admin/catalog');

    expect(
      await screen.findByRole('heading', { name: /panel de administración/i }),
    ).toBeInTheDocument();
  });

  it('sends /admin/pricing straight to the Impuestos tab for a user with pricing.manage', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access', 'pricing.manage'] });

    renderAt('/admin/pricing');

    // Dos enlaces "Impuestos" en pantalla a la vez: el del menú lateral
    // (a /admin/pricing) y la pestaña propia de PricingPage (a
    // /admin/pricing/taxes) — se comprueba la pestaña, no el menú.
    const tabs = await screen.findByRole('navigation', { name: 'Precios' });
    await within(tabs).findByRole('link', { name: 'Fórmula' });
    expect(within(tabs).getByRole('link', { name: 'Impuestos' })).toBeInTheDocument();
  });

  it('bounces a user without pricing.manage away from /admin/pricing', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access'] });

    renderAt('/admin/pricing');

    expect(
      await screen.findByRole('heading', { name: /panel de administración/i }),
    ).toBeInTheDocument();
  });

  it('lets any signed-in admin-panel user into /admin/account, no extra permission needed', async () => {
    stubFetch({ me: 'admin', permissions: ['admin.access'] });

    renderAt('/admin/account');

    expect(await screen.findByRole('heading', { name: /mi cuenta/i })).toBeInTheDocument();
  });
});
