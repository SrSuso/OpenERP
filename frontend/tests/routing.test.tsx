import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { routes } from '@/routes';

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('routing', () => {
  it('renders the admin panel at /admin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ status: 'ok', app: 'OpenERP', environment: 'test' }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );

    renderAt('/admin');

    expect(
      await screen.findByRole('heading', { name: /panel de administración/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('api-status')).toHaveTextContent('ok · OpenERP · test'),
    );
  });

  it('renders the POS at /pos', async () => {
    renderAt('/pos');

    expect(await screen.findByRole('heading', { name: /punto de venta/i })).toBeInTheDocument();
  });

  it('does not render the admin shell inside the POS', async () => {
    renderAt('/pos');

    await screen.findByRole('heading', { name: /punto de venta/i });
    expect(screen.queryByRole('link', { name: /inicio/i })).not.toBeInTheDocument();
  });

  it('redirects the root path to the admin panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ status: 'ok', app: 'OpenERP', environment: 'test' }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );

    renderAt('/');

    expect(
      await screen.findByRole('heading', { name: /panel de administración/i }),
    ).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown route', async () => {
    renderAt('/nope');

    expect(
      await screen.findByRole('heading', { name: /página no encontrada/i }),
    ).toBeInTheDocument();
  });

  it('surfaces an API failure instead of hanging on the loading state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'service_unavailable', message: 'Database is not reachable.' },
              request_id: 'req-1',
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );

    renderAt('/admin');

    await waitFor(() =>
      expect(screen.getByTestId('api-status')).toHaveTextContent(/sin conexión/i),
    );
  });
});
