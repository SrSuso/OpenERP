import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Product } from '@/features/catalog/api';
import { type FefoAllocation, type Lot, type LotBalance } from '@/features/lots/api';

import { LotsPage } from './LotsPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function isoFromToday(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function product(overrides: Partial<Product>): Product {
  return {
    id: 10,
    sku: 'P000010',
    name: 'Yogur natural',
    description: '',
    category_id: null,
    category_name: null,
    pos_category_id: null,
    pos_category_name: null,
    pos_display_order: 0,
    base_unit_name: 'UDS.',
    cost: '0.500000',
    list_price: '1.000000',
    tax_rate: '0',
    effective_tax_rate: '0',
    surcharge_rate: '0',
    margin_rate: null,
    margin_amount: null,
    taxes: [],
    price_formula: null,
    min_stock: '0',
    stock_alert_mode: 'GENERAL',
    track_lots: true,
    track_expiration: true,
    tracks_stock: null,
    effective_tracks_stock: true,
    is_active: true,
    packages: [],
    ...overrides,
  };
}

function stubBackend({
  canManage = true,
  empty = false,
  failFirstConsume = false,
  lotCount,
  failSecondPage = false,
}: {
  canManage?: boolean;
  empty?: boolean;
  failFirstConsume?: boolean;
  lotCount?: number;
  failSecondPage?: boolean;
} = {}) {
  const products = [
    product({}),
    product({ id: 20, sku: 'P000020', name: 'Leche entera' }),
    product({
      id: 30,
      sku: 'P000030',
      name: 'Servicio de reparto',
      track_lots: false,
      track_expiration: false,
    }),
  ];
  const defaultLots: Lot[] = [
    {
      id: 1,
      product_id: 10,
      lot_number: 'YG-CADUCADO',
      manufacturing_date: null,
      expiration_date: isoFromToday(-2),
      supplier_id: 1,
      purchase_order_id: null,
    },
    {
      id: 2,
      product_id: 20,
      lot_number: 'LE-AVISO',
      manufacturing_date: null,
      expiration_date: isoFromToday(4),
      supplier_id: 1,
      purchase_order_id: null,
    },
    {
      id: 3,
      product_id: 10,
      lot_number: 'YG-SIN-FECHA',
      manufacturing_date: null,
      expiration_date: null,
      supplier_id: null,
      purchase_order_id: null,
    },
  ];
  const lots: Lot[] = empty
    ? []
    : lotCount === undefined
      ? defaultLots
      : Array.from({ length: lotCount }, (_, index) => ({
          id: index + 1,
          product_id: index === lotCount - 1 ? 20 : 10,
          lot_number: `LOTE-${String(index + 1).padStart(3, '0')}`,
          manufacturing_date: null,
          expiration_date: isoFromToday(index + 1),
          supplier_id: null,
          purchase_order_id: null,
        }));
  let nextLotId = 10;
  const consumeKeys: string[] = [];
  const lotRequests: string[] = [];
  const createCalls: Record<string, unknown>[] = [];

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
            role: 'ADMIN',
            permissions: [
              'admin.access',
              'lot.read',
              'notification.read',
              ...(canManage ? ['lot.manage'] : []),
            ],
          }),
        );
      }
      if (method === 'GET' && /\/products\?/.test(url)) {
        return Promise.resolve(jsonResponse(products));
      }
      if (method === 'GET' && /\/suppliers\?/.test(url)) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 1,
              name: 'Lácteos SA',
              tax_id: null,
              email: null,
              phone: null,
              address: '',
              is_active: true,
            },
          ]),
        );
      }
      if (method === 'GET' && url.endsWith('/alerts')) {
        return Promise.resolve(
          jsonResponse(
            lots
              .filter((lot) => lot.id === 2)
              .map((lot) => ({
                id: 50,
                kind: 'EXPIRATION',
                title: 'Leche entera',
                product_id: 20,
                stock_current: null,
                min_stock: null,
                replenish: null,
                lot_id: lot.id,
                lot_number: lot.lot_number,
                expiration_date: lot.expiration_date,
                days_remaining: 4,
                quantity_remaining: '8',
              })),
          ),
        );
      }
      if (method === 'GET' && /\/lots\?/.test(url)) {
        lotRequests.push(url);
        const parsed = new URL(url, 'http://test');
        const offset = Number(parsed.searchParams.get('offset') ?? 0);
        const limit = Number(parsed.searchParams.get('limit') ?? 100);
        if (failSecondPage && offset === 100) {
          return Promise.resolve(jsonResponse({ error: 'page failed' }, { status: 500 }));
        }
        const requestedProduct = parsed.searchParams.get('product_id');
        const requestedSearch = (parsed.searchParams.get('search') ?? '').toLocaleLowerCase('es');
        const requestedExpiration = parsed.searchParams.get('expiration_status') ?? 'all';
        const today = isoFromToday(0);
        const filtered = lots
          .filter((lot) => {
            const productName = products.find((item) => item.id === lot.product_id)?.name ?? '';
            return (
              (!requestedProduct || lot.product_id === Number(requestedProduct)) &&
              (!requestedSearch ||
                lot.lot_number.toLocaleLowerCase('es').includes(requestedSearch) ||
                productName.toLocaleLowerCase('es').includes(requestedSearch)) &&
              (requestedExpiration === 'all' ||
                (requestedExpiration === 'alert' && lot.id === 2) ||
                (requestedExpiration === 'expired' &&
                  lot.expiration_date !== null &&
                  lot.expiration_date < today) ||
                (requestedExpiration === 'undated' && lot.expiration_date === null))
            );
          })
          .sort((left, right) => {
            if (left.expiration_date === null)
              return right.expiration_date === null ? left.id - right.id : 1;
            if (right.expiration_date === null) return -1;
            return left.expiration_date.localeCompare(right.expiration_date) || left.id - right.id;
          });
        return Promise.resolve(jsonResponse(filtered.slice(offset, offset + limit)));
      }
      if (method === 'POST' && /\/lots$/.test(url)) {
        const payload = body();
        createCalls.push(payload);
        const created: Lot = {
          id: nextLotId++,
          product_id: payload['product_id'] as number,
          lot_number: payload['lot_number'] as string,
          manufacturing_date: (payload['manufacturing_date'] as string | null) ?? null,
          expiration_date: (payload['expiration_date'] as string | null) ?? null,
          supplier_id: (payload['supplier_id'] as number | null) ?? null,
          purchase_order_id: null,
        };
        lots.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'GET' && url.endsWith('/warehouses')) {
        return Promise.resolve(jsonResponse([{ id: 1, name: 'Almacén central', is_active: true }]));
      }
      if (method === 'GET' && /\/warehouses\/1\/locations/.test(url)) {
        return Promise.resolve(
          jsonResponse([{ id: 1, warehouse_id: 1, name: 'Cámara', is_active: true }]),
        );
      }
      if (method === 'GET' && /\/lot-balances\?/.test(url)) {
        const productId = Number(/\/products\/(\d+)\/lot-balances/.exec(url)![1]);
        const balances: LotBalance[] = lots
          .filter((lot) => lot.product_id === productId)
          .map((lot) => ({ lot, quantity: '10' }));
        return Promise.resolve(jsonResponse(balances));
      }
      if (method === 'POST' && /\/fefo-plan$/.test(url)) {
        const productId = Number(/\/products\/(\d+)\/fefo-plan/.exec(url)![1]);
        const first = lots.find((lot) => lot.product_id === productId)!;
        const allocations: FefoAllocation[] = [
          {
            lot_id: first.id,
            lot_number: first.lot_number,
            expiration_date: first.expiration_date,
            quantity: body()['quantity'] as string,
          },
        ];
        return Promise.resolve(jsonResponse({ allocations }));
      }
      if (method === 'POST' && /\/fefo-consume$/.test(url)) {
        consumeKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        if (failFirstConsume && consumeKeys.length === 1) {
          return Promise.reject(new TypeError('Connection lost after sending request'));
        }
        return Promise.resolve(jsonResponse({ allocations: [], movement_ids: [1] }));
      }
      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url}`));
    }),
  );

  return { lotRequests, createCalls, consumeKeys };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LotsPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('LotsPage V2', () => {
  it('loads the first page, shows product names and keeps backend expiry order', async () => {
    const backend = stubBackend();
    renderPage();
    expect(await screen.findByText('YG-CADUCADO')).toBeInTheDocument();
    expect(screen.getByText('LE-AVISO')).toBeInTheDocument();
    expect(screen.getByText('YG-SIN-FECHA')).toBeInTheDocument();
    expect(screen.getAllByText('Yogur natural')).not.toHaveLength(0);
    expect(screen.getAllByText('Leche entera')).not.toHaveLength(0);
    expect(screen.queryByText('P000010')).not.toBeInTheDocument();
    expect(screen.getByText('Caducado')).toBeInTheDocument();
    expect(await screen.findByText('Caduca en 4 días')).toBeInTheDocument();
    expect(screen.getByText('Sin caducidad')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('YG-CADUCADO')).toBeInTheDocument();
    expect(within(rows.at(-1)!).getByText('YG-SIN-FECHA')).toBeInTheDocument();
    expect(new URL(backend.lotRequests[0]!, 'http://test').searchParams.has('product_id')).toBe(
      false,
    );
  });

  it('loads subsequent pages without replacing earlier lots and hides the button at the end', async () => {
    const backend = stubBackend({ lotCount: 250 });
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText('LOTE-001')).toBeInTheDocument();
    expect(screen.getByText('LOTE-100')).toBeInTheDocument();
    expect(screen.queryByText('LOTE-101')).not.toBeInTheDocument();
    expect(screen.getByText('Mostrando 100 lotes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText('LOTE-200')).toBeInTheDocument();
    expect(screen.getByText('LOTE-001')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 200 lotes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText('LOTE-250')).toBeInTheDocument();
    expect(screen.getByText('LOTE-001')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 250 lotes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
    expect(
      backend.lotRequests.map(
        (request) => new URL(request, 'http://test').searchParams.get('offset') ?? '0',
      ),
    ).toEqual(['0', '100', '200']);
  });

  it('keeps the first page visible when loading the next page fails', async () => {
    stubBackend({ lotCount: 205, failSecondPage: true });
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText('LOTE-001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText(/No se han podido cargar más lotes/)).toBeInTheDocument();
    expect(screen.getByText('LOTE-001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('searches outside the first page on the server and resets loaded pages for new filters', async () => {
    const backend = stubBackend({ lotCount: 250 });
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText('LOTE-001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText('LOTE-150')).toBeInTheDocument();

    const search = screen.getByLabelText('Buscar producto o lote');
    await user.click(search);
    await user.paste('LOTE-180');
    expect(await screen.findByText('LOTE-180')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('LOTE-001')).not.toBeInTheDocument());
    const searchRequest = backend.lotRequests.find((request) =>
      new URL(request, 'http://test').searchParams.has('search'),
    );
    expect(new URL(searchRequest!, 'http://test').searchParams.get('offset')).toBe('0');

    await user.clear(search);
    await user.selectOptions(screen.getByLabelText('Producto'), '20');
    expect(await screen.findByText('LOTE-250')).toBeInTheDocument();
    expect(screen.queryByText('LOTE-001')).not.toBeInTheDocument();
    const productRequest = backend.lotRequests.find((request) =>
      new URL(request, 'http://test').searchParams.has('product_id'),
    );
    expect(new URL(productRequest!, 'http://test').searchParams.get('offset')).toBe('0');
  });

  it('filters by product name, lot number and expiration state', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('YG-CADUCADO');
    const search = screen.getByLabelText('Buscar producto o lote');
    await user.type(search, 'Leche');
    expect(screen.getByText('LE-AVISO')).toBeInTheDocument();
    expect(screen.queryByText('YG-CADUCADO')).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'SIN-FECHA');
    expect(screen.getByText('YG-SIN-FECHA')).toBeInTheDocument();
    await user.clear(search);
    await user.selectOptions(screen.getByLabelText('Estado de caducidad'), 'alert');
    expect(screen.getByText('LE-AVISO')).toBeInTheDocument();
    expect(screen.queryByText('YG-CADUCADO')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Estado de caducidad'), 'expired');
    expect(screen.getByText('YG-CADUCADO')).toBeInTheDocument();
  });

  it('creates a lot from an on-demand form and excludes products that do not track lots', async () => {
    const backend = stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('YG-CADUCADO');
    expect(screen.queryByLabelText('Número de lote')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Nuevo lote' }));
    expect(screen.queryByText('Servicio de reparto')).not.toBeInTheDocument();
    const form = screen.getByRole('heading', { name: 'Nuevo lote' }).closest('section')!;
    await user.type(within(form).getByLabelText('Producto'), 'Yogur');
    await user.click(within(form).getByRole('button', { name: 'Elegir Yogur natural' }));
    await user.type(screen.getByLabelText('Número de lote'), 'YG-NUEVO');
    await user.type(screen.getByLabelText('Fecha de caducidad'), isoFromToday(10));
    await user.selectOptions(screen.getByLabelText('Proveedor'), '1');
    await user.click(screen.getByRole('button', { name: 'Crear lote' }));
    expect(await screen.findByText('Lote YG-NUEVO creado correctamente.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Número de lote')).not.toBeInTheDocument();
    expect(await screen.findByText('YG-NUEVO')).toBeInTheDocument();
    expect(backend.createCalls).toEqual([
      {
        product_id: 10,
        lot_number: 'YG-NUEVO',
        manufacturing_date: null,
        expiration_date: isoFromToday(10),
        supplier_id: 1,
        purchase_order_id: null,
      },
    ]);
  });

  it('opens stock from a row, auto-selects the only warehouse/location and keeps output closed', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('YG-CADUCADO');
    await user.click(
      screen.getByRole('button', {
        name: 'Ver existencias de Yogur natural, lote YG-CADUCADO',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Existencias por lote' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Almacén')).toHaveValue('1'));
    await waitFor(() => expect(screen.getByLabelText('Ubicación')).toHaveValue('1'));
    await waitFor(() => expect(screen.getAllByText('YG-CADUCADO')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Registrar salida' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Cantidad')).not.toBeInTheDocument();
  });

  it('closes stock explicitly or when filters exclude it and switches context directly', async () => {
    stubBackend();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('YG-CADUCADO');

    await user.click(
      screen.getByRole('button', {
        name: 'Ver existencias de Yogur natural, lote YG-CADUCADO',
      }),
    );
    expect(await screen.findByText('Lote YG-CADUCADO')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('heading', { name: 'Existencias por lote' })).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Ver existencias de Leche entera, lote LE-AVISO' }),
    );
    expect(await screen.findByText('Lote LE-AVISO')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Ver existencias de Yogur natural, lote YG-SIN-FECHA',
      }),
    );
    expect(await screen.findByText('Lote YG-SIN-FECHA')).toBeInTheDocument();
    expect(screen.queryByText('Lote LE-AVISO')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Producto'), '10');
    expect(screen.getByRole('heading', { name: 'Existencias por lote' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Producto'), '20');
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Existencias por lote' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('previews and confirms a friendly output flow while preserving its retry key', async () => {
    const backend = stubBackend({ failFirstConsume: true });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('YG-CADUCADO');
    await user.click(
      screen.getByRole('button', {
        name: 'Ver existencias de Yogur natural, lote YG-CADUCADO',
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Ubicación')).toHaveValue('1'));
    await user.click(screen.getByRole('button', { name: 'Registrar salida' }));
    expect(screen.getByText(/utilizará primero los lotes que caducan antes/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Cantidad'), '5');
    await user.selectOptions(screen.getByLabelText('Motivo'), 'WASTE');
    await user.type(screen.getByLabelText('Nota'), 'Envase roto');
    await user.click(screen.getByRole('button', { name: 'Previsualizar' }));
    expect(await screen.findByText('Se descontará de estos lotes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar salida' }));
    expect(await screen.findByText('No se ha podido registrar la salida.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar salida' }));
    expect(await screen.findByText('Salida registrada correctamente.')).toBeInTheDocument();
    expect(backend.consumeKeys).toHaveLength(2);
    expect(backend.consumeKeys[0]).not.toBe('');
    expect(backend.consumeKeys[1]).toBe(backend.consumeKeys[0]);
  });

  it('respects read-only permissions and renders an empty state', async () => {
    stubBackend({ canManage: false, empty: true });
    renderPage();
    expect(await screen.findByText('Todavía no hay lotes registrados')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Nuevo lote' })).not.toBeInTheDocument();
  });
});
