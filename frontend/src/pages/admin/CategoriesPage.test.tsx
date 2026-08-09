import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type PosCategory, type ProductCategory } from '@/features/catalog/api';

import { CategoriesPage } from './CategoriesPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const ME = {
  id: 1,
  email: 'admin@example.com',
  full_name: 'Admin Uno',
  role: 'ADMIN',
  permissions: ['admin.access', 'product.read', 'product.manage', 'pos_category.manage'],
};

function stubBackend() {
  const categories: ProductCategory[] = [{ id: 1, name: 'Bebidas', is_active: true }];
  const posCategories: PosCategory[] = [
    { id: 1, name: 'Ofertas', color: '#64748b', display_order: 0, is_active: true },
  ];
  const createCategoryCalls: string[] = [];
  const createPosCategoryCalls: Record<string, unknown>[] = [];
  const deactivatePosCategoryCalls: number[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));

      if (method === 'GET' && url.includes('/product-categories')) {
        return Promise.resolve(jsonResponse(categories));
      }
      if (method === 'POST' && url.includes('/product-categories')) {
        const body = init?.body
          ? (JSON.parse(init.body as string) as { name: string })
          : { name: '' };
        createCategoryCalls.push(body.name);
        const created = { id: 2, name: body.name, is_active: true };
        categories.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'GET' && url.includes('/pos-categories')) {
        return Promise.resolve(jsonResponse(posCategories));
      }
      if (method === 'POST' && /\/pos-categories$/.test(url)) {
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        createPosCategoryCalls.push(body);
        const created: PosCategory = {
          id: 2,
          name: body['name'] as string,
          color: body['color'] as string,
          display_order: body['display_order'] as number,
          is_active: true,
        };
        posCategories.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'POST' && /\/pos-categories\/(\d+)\/deactivate$/.test(url)) {
        const id = Number(/\/pos-categories\/(\d+)\/deactivate$/.exec(url)![1]);
        deactivatePosCategoryCalls.push(id);
        const category = posCategories.find((c) => c.id === id)!;
        category.is_active = false;
        return Promise.resolve(jsonResponse(category));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCategoryCalls, createPosCategoryCalls, deactivatePosCategoryCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CategoriesPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('CategoriesPage', () => {
  it('lists product categories and POS categories', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByText('Bebidas')).toBeInTheDocument();
    expect(screen.getByText('Ofertas')).toBeInTheDocument();
  });

  it('creates a product category', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Bebidas');

    await userEvent.type(screen.getByPlaceholderText('Nombre de la categoría'), 'Lácteos');
    await userEvent.click(screen.getAllByRole('button', { name: 'Añadir' })[0]!);

    expect(await screen.findByText('Lácteos')).toBeInTheDocument();
    expect(backend.createCategoryCalls).toEqual(['Lácteos']);
  });

  it('creates a POS category with a name, color and order', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Ofertas');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Congelados');
    // Two "Añadir" buttons on this page (product categories + POS
    // categories); the POS one is the second in DOM order.
    await userEvent.click(screen.getAllByRole('button', { name: 'Añadir' })[1]!);

    await screen.findByText('Congelados');
    expect(backend.createPosCategoryCalls).toEqual([
      { name: 'Congelados', color: '#64748b', display_order: 0 },
    ]);
  });

  it('deactivates a POS category', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Ofertas');

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    await screen.findByText(/Ofertas.*inactiva/);
    expect(backend.deactivatePosCategoryCalls).toEqual([1]);
  });
});
