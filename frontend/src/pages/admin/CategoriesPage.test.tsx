import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type PosCategory, type ProductCategory, type Unit } from '@/features/catalog/api';
import { type Tax } from '@/features/pricing/api';

import { CategoriesPage } from './CategoriesPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const FULL_PERMISSIONS = [
  'admin.access',
  'product.read',
  'product.manage',
  'pos_category.manage',
  'pricing.manage',
];

function stubBackend({
  permissions = FULL_PERMISSIONS,
  role = 'ADMIN',
  emptyCategories = false,
  categoryInUse = false,
}: {
  permissions?: string[];
  role?: string;
  emptyCategories?: boolean;
  categoryInUse?: boolean;
} = {}) {
  const categories: ProductCategory[] = emptyCategories
    ? []
    : [
        {
          id: 1,
          name: 'Bebidas',
          is_active: true,
          margin_rate: null,
          margin_amount: null,
          price_formula: null,
          tracks_stock: true,
          is_sold_by_weight: false,
          quick_price_edit: false,
          default_unit_name: null,
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
  const calls = {
    createCategory: [] as Record<string, unknown>[],
    updateCategory: [] as { id: number; body: Record<string, unknown> }[],
    categoryPricing: [] as { id: number; body: Record<string, unknown> }[],
    deactivateCategory: [] as number[],
    deleteCategory: [] as number[],
    createPos: [] as Record<string, unknown>[],
    updatePos: [] as { id: number; body: Record<string, unknown> }[],
    createUnit: [] as string[],
    updateUnit: [] as { id: number; name: string }[],
    deleteUnit: [] as number[],
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) {
        return Promise.resolve(
          jsonResponse({
            id: 1,
            email: 'admin@example.com',
            full_name: 'Admin Uno',
            role,
            permissions,
          }),
        );
      }
      if (method === 'GET' && url.includes('/product-categories')) {
        return Promise.resolve(jsonResponse(categories));
      }
      if (method === 'POST' && /\/product-categories$/.test(url)) {
        const payload = body();
        calls.createCategory.push(payload);
        const created: ProductCategory = {
          id: 2,
          name: payload['name'] as string,
          is_active: true,
          margin_rate: (payload['margin_rate'] as string | null) ?? null,
          margin_amount: (payload['margin_amount'] as string | null) ?? null,
          price_formula: (payload['price_formula'] as string | null) ?? null,
          tracks_stock: payload['tracks_stock'] as boolean,
          is_sold_by_weight: payload['is_sold_by_weight'] as boolean,
          quick_price_edit: payload['quick_price_edit'] as boolean,
          default_unit_name: (payload['default_unit_name'] as string | null) ?? null,
          taxes: taxes.filter((tax) => (payload['tax_ids'] as number[]).includes(tax.id)),
        };
        categories.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const categoryMatch = /\/product-categories\/(\d+)$/.exec(url);
      if (method === 'PATCH' && categoryMatch) {
        const id = Number(categoryMatch[1]);
        const payload = body();
        calls.updateCategory.push({ id, body: payload });
        const category = categories.find((item) => item.id === id)!;
        category.name = payload['name'] as string;
        category.tracks_stock = payload['tracks_stock'] as boolean;
        category.is_sold_by_weight = payload['is_sold_by_weight'] as boolean;
        category.quick_price_edit = payload['quick_price_edit'] as boolean;
        category.default_unit_name = payload['default_unit_name'] as string | null;
        return Promise.resolve(jsonResponse(category));
      }
      const pricingMatch = /\/product-categories\/(\d+)\/pricing$/.exec(url);
      if (method === 'PATCH' && pricingMatch) {
        const id = Number(pricingMatch[1]);
        const payload = body();
        calls.categoryPricing.push({ id, body: payload });
        const category = categories.find((item) => item.id === id)!;
        category.margin_rate = payload['margin_rate'] as string | null;
        category.margin_amount = payload['margin_amount'] as string | null;
        if ('price_formula' in payload) {
          category.price_formula = (payload['price_formula'] as string) || null;
        }
        category.taxes = taxes.filter((tax) => (payload['tax_ids'] as number[]).includes(tax.id));
        return Promise.resolve(jsonResponse(category));
      }
      const activeMatch = /\/product-categories\/(\d+)\/(de)?activate$/.exec(url);
      if (method === 'POST' && activeMatch) {
        const id = Number(activeMatch[1]);
        const category = categories.find((item) => item.id === id)!;
        category.is_active = activeMatch[2] === undefined;
        if (activeMatch[2]) calls.deactivateCategory.push(id);
        return Promise.resolve(jsonResponse(category));
      }
      if (method === 'DELETE' && categoryMatch) {
        const id = Number(categoryMatch[1]);
        calls.deleteCategory.push(id);
        if (categoryInUse) {
          return Promise.resolve(
            jsonResponse(
              { error: { code: 'conflict', message: 'La usan 3 productos.' } },
              { status: 409 },
            ),
          );
        }
        categories.splice(
          categories.findIndex((item) => item.id === id),
          1,
        );
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      if (method === 'GET' && url.includes('/pos-categories')) {
        return Promise.resolve(jsonResponse(posCategories));
      }
      if (method === 'POST' && /\/pos-categories$/.test(url)) {
        const payload = body();
        calls.createPos.push(payload);
        const created: PosCategory = {
          id: 2,
          name: payload['name'] as string,
          color: payload['color'] as string,
          display_order: payload['display_order'] as number,
          is_active: true,
        };
        posCategories.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const posMatch = /\/pos-categories\/(\d+)$/.exec(url);
      if (method === 'PATCH' && posMatch) {
        const id = Number(posMatch[1]);
        const payload = body();
        calls.updatePos.push({ id, body: payload });
        const category = posCategories.find((item) => item.id === id)!;
        category.name = payload['name'] as string;
        category.color = payload['color'] as string;
        category.display_order = payload['display_order'] as number;
        return Promise.resolve(jsonResponse(category));
      }
      const posActive = /\/pos-categories\/(\d+)\/(de)?activate$/.exec(url);
      if (method === 'POST' && posActive) {
        const category = posCategories.find((item) => item.id === Number(posActive[1]))!;
        category.is_active = posActive[2] === undefined;
        return Promise.resolve(jsonResponse(category));
      }
      if (method === 'DELETE' && posMatch) {
        posCategories.splice(
          posCategories.findIndex((item) => item.id === Number(posMatch[1])),
          1,
        );
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      if (method === 'GET' && url.includes('/units')) return Promise.resolve(jsonResponse(units));
      if (method === 'POST' && /\/units$/.test(url)) {
        const name = body()['name'] as string;
        calls.createUnit.push(name);
        const created = { id: units.length + 1, name, display_order: units.length };
        units.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const unitMatch = /\/units\/(\d+)$/.exec(url);
      if (method === 'PATCH' && unitMatch) {
        const id = Number(unitMatch[1]);
        const name = body()['name'] as string;
        calls.updateUnit.push({ id, name });
        const unit = units.find((item) => item.id === id)!;
        unit.name = name;
        return Promise.resolve(jsonResponse(unit));
      }
      if (method === 'DELETE' && unitMatch) {
        const id = Number(unitMatch[1]);
        calls.deleteUnit.push(id);
        units.splice(
          units.findIndex((item) => item.id === id),
          1,
        );
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (method === 'GET' && url.includes('/taxes')) return Promise.resolve(jsonResponse(taxes));
      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url}`));
    }),
  );

  return calls;
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

describe('CategoriesPage V2', () => {
  it('starts with product categories and separates TPV and units into clear sections', async () => {
    stubBackend();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Categorías' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Categorías de producto' })).toBeInTheDocument();
    expect(await screen.findByText('Control de stock')).toBeInTheDocument();
    expect(screen.queryByText('Ofertas')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'TPV' }));
    expect(await screen.findByRole('heading', { name: 'Categorías del TPV' })).toBeInTheDocument();
    expect(screen.getByText(/No cambian la categoría de inventario/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unidades' }));
    expect(await screen.findByRole('heading', { name: 'Unidades' })).toBeInTheDocument();
  });

  it('creates a complete category with independent stock, weight and quick-PVP choices', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Bebidas');
    await user.click(screen.getByRole('button', { name: '+ Nueva categoría' }));
    await user.type(screen.getByLabelText('Nombre'), 'Fruta');
    await user.selectOptions(screen.getByLabelText('Unidad por defecto'), 'UNIT');
    await user.click(screen.getByRole('checkbox', { name: /Vender al peso/ }));
    await user.click(screen.getByRole('checkbox', { name: /Permitir cambiar el PVP/ }));
    await user.type(screen.getByLabelText('Margen porcentual (%)'), '25');
    await user.type(screen.getByLabelText('Margen fijo (€)'), '0,20');
    const advanced = screen.getByText('Configuración avanzada').closest('details')!;
    expect(advanced).not.toHaveAttribute('open');
    await user.click(screen.getByText('Configuración avanzada'));
    expect(advanced).toHaveAttribute('open');
    await user.type(screen.getByLabelText('Fórmula personalizada'), 'cost * 2');
    await user.click(screen.getByRole('button', { name: /IVA general/ }));
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }));

    expect(await screen.findByText('Fruta')).toBeInTheDocument();
    expect(calls.createCategory).toEqual([
      {
        name: 'Fruta',
        tracks_stock: true,
        is_sold_by_weight: true,
        quick_price_edit: true,
        default_unit_name: 'UNIT',
        margin_rate: '25',
        margin_amount: '0,20',
        price_formula: 'cost * 2',
        tax_ids: [1],
      },
    ]);
    expect(screen.getByText('Control de stock · Por peso · PVP rápido')).toBeInTheDocument();
  });

  it('hides the technical formula from MANAGER while preserving normal pricing controls', async () => {
    const calls = stubBackend({ role: 'MANAGER' });
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('Bebidas');
    await user.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    expect(screen.queryByText('Configuración avanzada')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fórmula personalizada')).not.toBeInTheDocument();
    for (const variable of ['cost', 'tax_rate', 'surcharge_rate', 'margin_rate']) {
      expect(screen.queryByText(variable)).not.toBeInTheDocument();
    }
    await user.type(screen.getByLabelText('Margen porcentual (%)'), '20');
    await user.click(screen.getByRole('checkbox', { name: /Permitir cambiar el PVP/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(calls.categoryPricing).toHaveLength(1));
    expect(calls.categoryPricing[0]!.body).toEqual({
      margin_rate: '20',
      margin_amount: null,
      tax_ids: [],
    });
    expect(calls.updateCategory[0]!.body).toMatchObject({ quick_price_edit: true });
  });

  it('edits all category blocks and sends quick PVP independently from weight sales', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Bebidas');
    await user.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Refrescos');
    await user.click(screen.getByRole('checkbox', { name: /Llevar control/ }));
    await user.click(screen.getByRole('checkbox', { name: /Permitir cambiar el PVP/ }));
    await user.selectOptions(screen.getByLabelText('Unidad por defecto'), 'UNIT');
    await user.type(screen.getByLabelText('Margen fijo (€)'), '0.25');
    await user.click(screen.getByRole('button', { name: /IVA reducido/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Refrescos')).toBeInTheDocument();
    expect(calls.updateCategory).toEqual([
      {
        id: 1,
        body: {
          name: 'Refrescos',
          tracks_stock: false,
          is_sold_by_weight: false,
          quick_price_edit: true,
          default_unit_name: 'UNIT',
        },
      },
    ]);
    expect(calls.categoryPricing).toEqual([
      {
        id: 1,
        body: { margin_rate: null, margin_amount: '0.25', price_formula: '', tax_ids: [2] },
      },
    ]);
  });

  it('protects unsaved edits when changing section or cancelling', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await screen.findByText('Bebidas');
    await user.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await user.type(screen.getByLabelText('Margen fijo (€)'), '0.25');
    await waitFor(() => expect(screen.getByLabelText('Margen fijo (€)')).toHaveValue('0.25'));
    await user.click(screen.getByRole('button', { name: 'TPV' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Categorías de producto' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByLabelText('Margen fijo (€)')).toHaveValue('0.25');
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Margen fijo (€)')).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it('keeps hide/delete secondary and reports a protected category', async () => {
    const calls = stubBackend({ categoryInUse: true });
    renderPage();
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await screen.findByText('Bebidas');
    await user.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    const advanced = screen.getByText('Acciones avanzadas').closest('details')!;
    expect(advanced).not.toHaveAttribute('open');
    await user.click(screen.getByText('Acciones avanzadas'));
    expect(advanced).toHaveAttribute('open');
    await user.click(screen.getByRole('button', { name: 'Ocultar categoría' }));
    expect(calls.deactivateCategory).toEqual([1]);

    await user.click(screen.getByRole('button', { name: 'Editar «Bebidas»' }));
    await user.click(screen.getByText('Acciones avanzadas'));
    await user.click(screen.getByRole('button', { name: 'Borrar definitivamente' }));
    expect(await screen.findByText('La usan 3 productos.')).toBeInTheDocument();
    expect(calls.deleteCategory).toEqual([1]);
    confirm.mockRestore();
  });

  it('respects view-only permissions and presents a useful empty state', async () => {
    stubBackend({ permissions: ['admin.access', 'product.read'], emptyCategories: true });
    renderPage();
    expect(await screen.findByText('Todavía no hay categorías de producto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Nueva categoría' })).not.toBeInTheDocument();
  });

  it('creates and edits a TPV category in its own section', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'TPV' }));
    await screen.findByText('Ofertas');
    await user.click(screen.getByRole('button', { name: '+ Nueva categoría TPV' }));
    await user.type(screen.getByLabelText('Nombre'), 'Congelados');
    await user.clear(screen.getByLabelText('Orden'));
    await user.type(screen.getByLabelText('Orden'), '2');
    await user.click(screen.getByRole('button', { name: 'Crear' }));
    expect(await screen.findByText('Congelados')).toBeInTheDocument();
    expect(calls.createPos).toEqual([{ name: 'Congelados', color: '#64748b', display_order: 2 }]);

    await user.click(screen.getByRole('button', { name: 'Editar «Ofertas»' }));
    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Promociones');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Promociones')).toBeInTheDocument();
    expect(calls.updatePos[0]).toMatchObject({ id: 1, body: { name: 'Promociones' } });
  });

  it('creates, renames and deletes a custom unit without priority controls', async () => {
    const calls = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Unidades' }));
    await screen.findByText('UNIT');
    expect(screen.queryByRole('button', { name: /Subir|Bajar/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Nueva unidad' }));
    await user.type(screen.getByLabelText('Nombre corto'), 'caja');
    await user.click(screen.getByRole('button', { name: 'Crear unidad' }));
    expect(await screen.findByText('CAJA')).toBeInTheDocument();
    expect(calls.createUnit).toEqual(['CAJA']);

    await user.click(screen.getByRole('button', { name: 'Editar unidad «UNIT»' }));
    const input = screen.getByLabelText('Nombre de la unidad «UNIT»');
    await user.clear(input);
    await user.type(input, 'botella');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('BOTELLA')).toBeInTheDocument();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Borrar unidad «BOTELLA»' }));
    expect(calls.deleteUnit).toEqual([1]);
    confirm.mockRestore();
  });
});
