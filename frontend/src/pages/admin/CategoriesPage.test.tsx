import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type PosCategory, type ProductCategory, type Unit } from '@/features/catalog/api';
import { type Tax } from '@/features/pricing/api';

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
  permissions: [
    'admin.access',
    'product.read',
    'product.manage',
    'pos_category.manage',
    'pricing.manage',
  ],
};

/** `inUse`: ids de categoría que el backend se negaría a borrar por tener
 * productos asignados (responde 409, igual que `service.delete_category`). */
function stubBackend({ inUse = [] }: { inUse?: number[] } = {}) {
  const categoriesInUse = new Set(inUse);
  const categories: ProductCategory[] = [
    {
      id: 1,
      name: 'Bebidas',
      is_active: true,
      margin_rate: null,
      margin_amount: null,
      price_formula: null,
      tracks_stock: true,
      taxes: [],
    },
  ];
  const posCategories: PosCategory[] = [
    { id: 1, name: 'Ofertas', color: '#64748b', display_order: 0, is_active: true },
  ];
  const units: Unit[] = [{ id: 1, name: 'UNIT', display_order: 0 }];
  const taxes: Tax[] = [
    { id: 1, name: 'IVA general', rate: '21', surcharge_rate: '5.2', is_active: true },
    { id: 2, name: 'IVA reducido', rate: '10', surcharge_rate: '1.4', is_active: true },
  ];
  const createCategoryCalls: string[] = [];
  const deleteCategoryCalls: number[] = [];
  const updateCategoryCalls: { id: number; name: string; tracks_stock: boolean }[] = [];
  const createPosCategoryCalls: Record<string, unknown>[] = [];
  const deactivatePosCategoryCalls: number[] = [];
  const createUnitCalls: string[] = [];
  const moveUnitCalls: { id: number; direction: string }[] = [];
  const categoryPricingCalls: { id: number; body: Record<string, unknown> }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));

      if (method === 'GET' && url.includes('/product-categories')) {
        return Promise.resolve(jsonResponse(categories));
      }
      if (method === 'PATCH' && /\/product-categories\/(\d+)$/.test(url)) {
        const id = Number(/\/product-categories\/(\d+)$/.exec(url)![1]);
        const body = init?.body
          ? (JSON.parse(init.body as string) as { name: string; tracks_stock: boolean })
          : { name: '', tracks_stock: true };
        updateCategoryCalls.push({ id, ...body });
        const category = categories.find((c) => c.id === id)!;
        category.name = body.name;
        category.tracks_stock = body.tracks_stock;
        return Promise.resolve(jsonResponse(category));
      }
      if (method === 'POST' && /\/product-categories\/(\d+)\/(de)?activate$/.test(url)) {
        const match = /\/product-categories\/(\d+)\/(de)?activate$/.exec(url)!;
        const category = categories.find((c) => c.id === Number(match[1]))!;
        category.is_active = match[2] === undefined;
        return Promise.resolve(jsonResponse(category));
      }
      if (method === 'DELETE' && /\/product-categories\/(\d+)$/.test(url)) {
        const id = Number(/\/product-categories\/(\d+)$/.exec(url)![1]);
        deleteCategoryCalls.push(id);
        if (categoriesInUse.has(id)) {
          return Promise.resolve(
            jsonResponse(
              {
                error: {
                  code: 'conflict',
                  message: 'No se puede borrar «Bebidas»: la usan 3 productos.',
                },
              },
              { status: 409 },
            ),
          );
        }
        categories.splice(
          categories.findIndex((c) => c.id === id),
          1,
        );
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (method === 'POST' && url.includes('/product-categories')) {
        const body = init?.body
          ? (JSON.parse(init.body as string) as { name: string })
          : { name: '' };
        createCategoryCalls.push(body.name);
        const created = {
          id: 2,
          name: body.name,
          is_active: true,
          margin_rate: null,
          margin_amount: null,
          price_formula: null,
          tracks_stock: true,
          taxes: [],
        };
        categories.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'PATCH' && /\/product-categories\/(\d+)\/pricing$/.test(url)) {
        const id = Number(/\/product-categories\/(\d+)\/pricing$/.exec(url)![1]);
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        categoryPricingCalls.push({ id, body });
        const category = categories.find((c) => c.id === id)!;
        if ('margin_rate' in body) category.margin_rate = body['margin_rate'] as string | null;
        if ('tax_ids' in body) {
          const ids = body['tax_ids'] as number[];
          category.taxes = taxes.filter((t) => ids.includes(t.id));
        }
        return Promise.resolve(jsonResponse(category));
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
      if (method === 'GET' && url.includes('/units')) {
        return Promise.resolve(jsonResponse(units));
      }
      if (method === 'POST' && /\/units$/.test(url)) {
        const body = init?.body
          ? (JSON.parse(init.body as string) as { name: string })
          : { name: '' };
        createUnitCalls.push(body.name);
        const created: Unit = {
          id: units.length + 1,
          name: body.name,
          display_order: units.length,
        };
        units.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'POST' && /\/units\/(\d+)\/move$/.test(url)) {
        const id = Number(/\/units\/(\d+)\/move$/.exec(url)![1]);
        const body = init?.body
          ? (JSON.parse(init.body as string) as { direction: string })
          : { direction: '' };
        moveUnitCalls.push({ id, direction: body.direction });
        const index = units.findIndex((u) => u.id === id);
        const target = body.direction === 'up' ? index - 1 : index + 1;
        if (index >= 0 && target >= 0 && target < units.length) {
          [units[index], units[target]] = [units[target]!, units[index]!];
        }
        return Promise.resolve(jsonResponse(units));
      }
      if (method === 'GET' && url.includes('/taxes')) {
        return Promise.resolve(jsonResponse(taxes));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return {
    createCategoryCalls,
    deleteCategoryCalls,
    updateCategoryCalls,
    createPosCategoryCalls,
    deactivatePosCategoryCalls,
    createUnitCalls,
    moveUnitCalls,
    categoryPricingCalls,
  };
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
  it('lists product categories, POS categories and units', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByText('Bebidas')).toBeInTheDocument();
    expect(screen.getByText('Ofertas')).toBeInTheDocument();
    expect(screen.getByText('UNIT')).toBeInTheDocument();
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
    // Tres botones "Añadir" en esta página (categorías de producto, POS y
    // unidades); el de POS es el segundo en el orden del DOM.
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

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Ofertas»' }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    confirmSpy.mockRestore();

    await screen.findByText(/Ofertas.*oculta/);
    expect(backend.deactivatePosCategoryCalls).toEqual([1]);
  });

  it('creates a unit', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('UNIT');

    await userEvent.type(screen.getByPlaceholderText('UNIT, KG, L…'), 'kg');
    await userEvent.click(screen.getAllByRole('button', { name: 'Añadir' })[2]!);

    expect(await screen.findByText('KG')).toBeInTheDocument();
    expect(backend.createUnitCalls).toEqual(['KG']);
  });

  it('sets a category default margin and taxes', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Bebidas');

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    const marginInput = screen.getByPlaceholderText('vacío = sin margen por defecto');
    await userEvent.type(marginInput, '25');
    await userEvent.click(screen.getByRole('button', { name: /IVA general/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(backend.categoryPricingCalls).toEqual([
      { id: 1, body: { margin_rate: '25', margin_amount: null, price_formula: '', tax_ids: [1] } },
    ]);
  });

  it('renames a category already created, and can back out without saving', async () => {
    const backend = stubBackend();
    // Salir con algo escrito y sin guardar pregunta antes: aquí se dice
    // que sí, que se descarte.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByText('Bebidas');

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await userEvent.clear(screen.getByLabelText('Nombre de «Bebidas»'));
    await userEvent.type(screen.getByLabelText('Nombre de «Bebidas»'), 'Refrescos');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('no has guardado'));
    expect(backend.updateCategoryCalls).toEqual([]);
    expect(screen.getByText('Bebidas')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre de «Bebidas»')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await userEvent.clear(screen.getByLabelText('Nombre de «Bebidas»'));
    await userEvent.type(screen.getByLabelText('Nombre de «Bebidas»'), 'Refrescos');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Refrescos')).toBeInTheDocument();
    expect(backend.updateCategoryCalls).toEqual([{ id: 1, name: 'Refrescos', tracks_stock: true }]);
  });

  it('sets a fixed amount and a formula that its products inherit', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Bebidas');

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    // Las tres formas de poner precio conviven: porcentaje, cantidad fija
    // en euros, y una fórmula para toda la familia.
    await userEvent.type(screen.getByPlaceholderText('p. ej. 0,25'), '0.25');
    await userEvent.type(screen.getByLabelText('Fórmula por defecto'), 'cost * 2');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => {
      expect(backend.categoryPricingCalls).toEqual([
        {
          id: 1,
          body: {
            margin_rate: null,
            margin_amount: '0.25',
            price_formula: 'cost * 2',
            tax_ids: [],
          },
        },
      ]);
    });
  });

  it('lets a whole category sell without stock control', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Bebidas');

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    const check = screen.getByRole('checkbox', { name: /Llevar control de existencias/ });
    expect(check).toBeChecked();
    await userEvent.click(check);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => {
      expect(backend.updateCategoryCalls).toEqual([
        { id: 1, name: 'Bebidas', tracks_stock: false },
      ]);
    });
  });

  it('keeps what was typed when the discard confirmation is refused', async () => {
    stubBackend();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await screen.findByText('Bebidas');

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await userEvent.type(screen.getByPlaceholderText('p. ej. 0,25'), '0.25');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(confirmSpy).toHaveBeenCalled();
    // Sigue abierto y con lo tecleado: nadie ha perdido nada.
    expect(screen.getByPlaceholderText('p. ej. 0,25')).toHaveValue('0.25');
  });

  it('closes without asking when nothing was touched', async () => {
    stubBackend();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByText('Bebidas');

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Nombre de «Bebidas»')).not.toBeInTheDocument();
  });

  it('applies one tax at a time: choosing another replaces the one marked', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Bebidas');

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await userEvent.click(screen.getByRole('button', { name: /IVA general/ }));
    await userEvent.click(screen.getByRole('button', { name: /IVA reducido/ }));

    expect(screen.getByRole('button', { name: /IVA general/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: /IVA reducido/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(backend.categoryPricingCalls).toEqual([
      {
        id: 1,
        body: { margin_rate: null, margin_amount: null, price_formula: '', tax_ids: [2] },
      },
    ]);
  });

  it('asks before hiding a category, and does nothing if you say no', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('Bebidas');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.queryByText('(oculta)')).not.toBeInTheDocument();

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }));

    expect(await screen.findByText('(oculta)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar' })).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('asks before deleting, and explains why it is refused when the category is in use', async () => {
    const backend = stubBackend({ inUse: [1] });
    renderPage();
    await screen.findByText('Bebidas');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await userEvent.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(backend.deleteCategoryCalls).toEqual([]);

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    expect(await screen.findByText(/la usan 3 productos/)).toBeInTheDocument();
    expect(backend.deleteCategoryCalls).toEqual([1]);
    expect(screen.getByText('Bebidas')).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('reorders units with the up/down buttons', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('UNIT');

    await userEvent.type(screen.getByPlaceholderText('UNIT, KG, L…'), 'kg');
    await userEvent.click(screen.getAllByRole('button', { name: 'Añadir' })[2]!);
    await screen.findByText('KG');

    await userEvent.click(screen.getByRole('button', { name: 'Subir KG' }));

    expect(backend.moveUnitCalls).toEqual([{ id: 2, direction: 'up' }]);
  });
});
