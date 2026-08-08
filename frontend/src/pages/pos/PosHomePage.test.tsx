import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type Sale } from '@/features/pos/api';

import { PosHomePage } from './PosHomePage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const WAREHOUSE = { id: 1, name: 'Tienda principal', is_active: true };
const LOCATION = { id: 1, warehouse_id: 1, name: 'Almacén', is_active: true };
const POS_CATEGORY = {
  id: 1,
  name: 'Bebidas',
  color: '#3b82f6',
  display_order: 0,
  is_active: true,
};
const MILK = {
  id: 1,
  sku: 'LECHE-1L',
  name: 'Leche entera 1L',
  pos_category_id: 1,
  pos_category_name: 'Bebidas',
  list_price: '1.200000',
  tax_rate: '10.000000',
  is_active: true,
  packages: [
    { id: 10, name: 'Brick', factor: '1.000000', is_base: true, barcodes: ['8410000000010'] },
  ],
};

function emptySale(id: number): Sale {
  return {
    id,
    warehouse_id: 1,
    location_id: 1,
    status: 'DRAFT',
    notes: '',
    lines: [],
    total: '0.000000',
  };
}

function saleWithMilkLine(id: number): Sale {
  return {
    id,
    warehouse_id: 1,
    location_id: 1,
    status: 'DRAFT',
    notes: '',
    lines: [
      {
        id: 900,
        product_id: 1,
        product_sku: 'LECHE-1L',
        product_name: 'Leche entera 1L',
        package_id: 10,
        package_name: 'Brick',
        quantity_packages: '1.000000',
        quantity_base: '1.000000',
        unit_price: '1.200000',
        tax_rate: '10.000000',
        discount_rate: '0.000000',
        subtotal: '1.200000',
        discount_amount: '0.000000',
        tax_amount: '0.120000',
        total: '1.320000',
      },
    ],
    total: '1.320000',
  };
}

/**
 * A minimal in-memory stand-in for the backend, tracked so tests can assert
 * on *how many times* a mutating endpoint was hit (e.g. "exactly one sale
 * was opened, not two") without hard-coding call order.
 */
function stubBackend(options: { existingDraft?: Sale } = {}) {
  let sale: Sale | null = options.existingDraft ?? null;
  let nextSaleId = 5;
  const postSalesCalls = { count: 0 };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/warehouses/1/locations')) {
        return Promise.resolve(jsonResponse([LOCATION]));
      }
      if (url.includes('/warehouses')) {
        return Promise.resolve(jsonResponse([WAREHOUSE]));
      }
      if (url.includes('/pos-categories')) {
        return Promise.resolve(jsonResponse([POS_CATEGORY]));
      }
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([MILK]));
      }
      if (url.includes('/sales') && url.includes('status=DRAFT')) {
        return Promise.resolve(jsonResponse(sale ? [sale] : []));
      }
      if (method === 'POST' && /\/sales$/.test(url)) {
        postSalesCalls.count += 1;
        sale = emptySale(nextSaleId++);
        return Promise.resolve(jsonResponse(sale, { status: 201 }));
      }
      if (method === 'POST' && /\/sales\/\d+\/lines$/.test(url)) {
        sale = saleWithMilkLine(sale?.id ?? nextSaleId);
        return Promise.resolve(jsonResponse(sale, { status: 201 }));
      }
      if (method === 'DELETE' && /\/sales\/\d+\/lines\/\d+$/.test(url)) {
        sale = sale ? emptySale(sale.id) : null;
        return Promise.resolve(jsonResponse(sale));
      }
      if (method === 'POST' && /\/sales\/\d+\/cancel$/.test(url)) {
        const cancelled = sale ? { ...sale, status: 'CANCELLED' as const } : null;
        sale = null;
        return Promise.resolve(jsonResponse(cancelled));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { postSalesCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosHomePage />
    </QueryClientProvider>,
  );
}

describe('PosHomePage', () => {
  it('opens a new draft sale when the till has none open, then lets the cashier tap a product onto it', async () => {
    const backend = stubBackend();
    renderPage();

    const productButton = await screen.findByRole('button', { name: /leche entera 1l/i });
    expect(backend.postSalesCalls.count).toBe(1);
    expect(screen.getByText(/el carrito está vacío/i)).toBeInTheDocument();

    await userEvent.click(productButton);

    expect(await screen.findAllByText('Leche entera 1L')).toHaveLength(2);
    const cart = screen.getByRole('button', { name: /cancelar venta/i }).closest('aside')!;
    expect(within(cart).getByText('Leche entera 1L')).toBeInTheDocument();
    expect(within(cart).getAllByText('1,32 €').length).toBeGreaterThan(0);
  });

  it('resumes an existing draft sale instead of opening a new one', async () => {
    const backend = stubBackend({ existingDraft: saleWithMilkLine(42) });
    renderPage();

    expect(await screen.findAllByText('Leche entera 1L')).toHaveLength(2);

    expect(backend.postSalesCalls.count).toBe(0);
  });

  it('removing the only line empties the cart', async () => {
    stubBackend({ existingDraft: saleWithMilkLine(42) });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /quitar leche entera 1l/i }));

    await screen.findByText(/el carrito está vacío/i);
  });

  it('cancelling the sale clears the cart and opens a fresh one', async () => {
    const backend = stubBackend({ existingDraft: saleWithMilkLine(42) });
    renderPage();

    expect(await screen.findAllByText('Leche entera 1L')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: /cancelar venta/i }));

    await screen.findByText(/el carrito está vacío/i);
    expect(backend.postSalesCalls.count).toBe(1);
  });
});
