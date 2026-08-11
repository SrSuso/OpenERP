import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type Sale, type Tender } from '@/features/pos/api';

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
/** Se vende pesando: un toque no puede venderlo, tiene que preguntar. */
const TOMATO = {
  id: 2,
  sku: 'TOMATE',
  name: 'Tomate',
  pos_category_id: 1,
  pos_category_name: 'Bebidas',
  base_unit_name: 'KG',
  list_price: '1.680000',
  tax_rate: '4.000000',
  is_active: true,
  packages: [
    {
      id: 20,
      name: 'KG',
      factor: '1.000000',
      is_base: true,
      barcodes: [],
    },
  ],
};
const MILK = {
  id: 1,
  sku: 'LECHE-1L',
  name: 'Leche entera 1L',
  pos_category_id: 1,
  pos_category_name: 'Bebidas',
  base_unit_name: 'UNIT',
  list_price: '1.200000',
  tax_rate: '10.000000',
  is_active: true,
  packages: [
    {
      id: 10,
      name: 'Brick',
      factor: '1.000000',
      is_base: true,
      barcodes: [{ id: 100, barcode: '8410000000010' }],
    },
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
    payments: [],
    change_due: '0.000000',
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
        quantity_returned: '0.000000',
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
    payments: [],
    change_due: '0.000000',
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
  const addLineCalls: Record<string, unknown>[] = [];
  const barcodeCalls: string[] = [];

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
        return Promise.resolve(jsonResponse([MILK, TOMATO]));
      }
      if (url.includes('/sales') && url.includes('status=DRAFT')) {
        return Promise.resolve(jsonResponse(sale ? [sale] : []));
      }
      if (method === 'POST' && /\/sales\/\d+\/checkout$/.test(url)) {
        const body = init?.body
          ? (JSON.parse(init.body as string) as { payments: Tender[] })
          : {
              payments: [],
            };
        const tendered = body.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const total = sale ? Number(sale.total) : 0;
        const completed: Sale = {
          ...(sale ?? emptySale(nextSaleId)),
          status: 'COMPLETED',
          payments: body.payments.map((p, index) => ({
            id: index + 1,
            method: p.method,
            amount: Number(p.amount).toFixed(6),
            created_at: '2026-08-08T10:00:00Z',
          })),
          change_due: Math.max(0, tendered - total).toFixed(6),
        };
        sale = null;
        return Promise.resolve(jsonResponse(completed));
      }
      if (method === 'POST' && /\/sales$/.test(url)) {
        postSalesCalls.count += 1;
        sale = emptySale(nextSaleId++);
        return Promise.resolve(jsonResponse(sale, { status: 201 }));
      }
      if (method === 'POST' && /\/sales\/\d+\/lines\/by-barcode$/.test(url)) {
        barcodeCalls.push((JSON.parse(init!.body as string) as { barcode: string }).barcode);
        sale = saleWithMilkLine(sale?.id ?? nextSaleId);
        return Promise.resolve(jsonResponse(sale, { status: 201 }));
      }
      if (method === 'POST' && /\/sales\/\d+\/lines$/.test(url)) {
        addLineCalls.push(
          init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
        );
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

  return { postSalesCalls, addLineCalls, barcodeCalls };
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

  it('asks how many grams before selling something that goes by weight', async () => {
    const backend = stubBackend();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /tomate/i }));

    // Un toque no lo ha vendido: primero hay que decir cuánto pesa.
    const dialog = await screen.findByRole('dialog', { name: /cantidad de tomate/i });
    expect(backend.addLineCalls).toEqual([]);

    await userEvent.type(within(dialog).getByLabelText('Gramos'), '500');
    // El importe se ve antes de aceptar: es lo que se le va a cobrar.
    expect(within(dialog).getByText('0,84 €')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Añadir' }));

    expect(backend.addLineCalls).toEqual([
      { product_id: 2, package_id: 20, quantity_packages: '0.500' },
    ]);
  });

  it('sells one unit on a plain tap when the product is not sold by weight', async () => {
    const backend = stubBackend();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /leche entera 1l/i }));

    await screen.findAllByText('Leche entera 1L');
    expect(backend.addLineCalls).toEqual([
      { product_id: 1, package_id: 10, quantity_packages: '1' },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sells several units at once with the keypad', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByRole('button', { name: /leche entera 1l/i });

    // Se teclea 3 y se pulsa el producto: una línea de tres, sin pulsarlo
    // tres veces.
    await userEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByLabelText('Cantidad para el siguiente producto')).toHaveTextContent('×3');

    await userEvent.click(screen.getByRole('button', { name: /leche entera 1l/i }));

    expect(backend.addLineCalls).toEqual([
      { product_id: 1, package_id: 10, quantity_packages: '3' },
    ]);
    // Y vuelve a una unidad: es para el siguiente producto, no un modo en
    // el que quedarse.
    expect(screen.getByLabelText('Cantidad para el siguiente producto')).toHaveTextContent('×1');
  });

  it('types the grams on the keypad of the weight dialog', async () => {
    const backend = stubBackend();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /tomate/i }));
    const dialog = await screen.findByRole('dialog', { name: /cantidad de tomate/i });

    for (const digit of ['2', '5', '0']) {
      await userEvent.click(within(dialog).getByRole('button', { name: digit }));
    }
    expect(within(dialog).getByLabelText('Gramos')).toHaveValue('250');

    // El último dígito se borra con ←, sin tener que empezar de cero.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Borrar un dígito' }));
    expect(within(dialog).getByLabelText('Gramos')).toHaveValue('25');

    await userEvent.click(within(dialog).getByRole('button', { name: '0' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Añadir' }));

    expect(backend.addLineCalls).toEqual([
      { product_id: 2, package_id: 20, quantity_packages: '0.250' },
    ]);
  });

  it('opens a second sale alongside the one already open', async () => {
    // Un cliente se deja el pan y se va a por él; detrás hay gente
    // esperando y hay que cobrarle sin perder el carrito del primero.
    const backend = stubBackend({ existingDraft: saleWithMilkLine(42) });
    renderPage();
    await screen.findAllByText('Leche entera 1L');
    expect(backend.postSalesCalls.count).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: '+ Venta nueva' }));

    expect(backend.postSalesCalls.count).toBe(1);
    // Las dos siguen abiertas y se puede volver a la primera.
    const first = await screen.findByRole('button', { name: /Venta 1/ });
    const second = screen.getByRole('button', { name: /Venta 2/ });
    expect(second).toHaveAttribute('aria-current', 'true');

    await userEvent.click(first);
    expect(first).toHaveAttribute('aria-current', 'true');
  });

  it('reads a scanned barcode without clicking into the box first', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await screen.findByRole('button', { name: /cancelar venta/i });

    // Un lector teclea el código entero de golpe y termina con Intro, sin
    // que nadie haya pinchado en ningún sitio.
    for (const key of '8410000000010') {
      fireEvent.keyDown(document, { key });
    }
    fireEvent.keyDown(document, { key: 'Enter' });

    await waitFor(() => expect(backend.barcodeCalls).toEqual(['8410000000010']));
  });

  it('reads a slower scanner too, and one that sends no Enter at all', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await screen.findByRole('button', { name: /cancelar venta/i });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // 80 ms por carácter: un lector por Bluetooth de los lentos.
      for (const key of '8410000000010') {
        fireEvent.keyDown(document, { key });
        vi.advanceTimersByTime(80);
      }
      // Sin Intro ni Tab: muchos vienen de fábrica sin sufijo, y se cierra
      // solo al dejar de llegar teclas.
      vi.advanceTimersByTime(500);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(backend.barcodeCalls).toEqual(['8410000000010']));
  });

  it('accepts Tab as the terminator, which many scanners send instead', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await screen.findByRole('button', { name: /cancelar venta/i });

    for (const key of '8410000000010') {
      fireEvent.keyDown(document, { key });
    }
    fireEvent.keyDown(document, { key: 'Tab' });

    await waitFor(() => expect(backend.barcodeCalls).toEqual(['8410000000010']));
  });

  it('ignores slow typing outside a field: that is not a scanner', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await screen.findByRole('button', { name: /cancelar venta/i });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      for (const key of '8410') {
        fireEvent.keyDown(document, { key });
        vi.advanceTimersByTime(200);
      }
      fireEvent.keyDown(document, { key: 'Enter' });
    } finally {
      vi.useRealTimers();
    }

    expect(backend.barcodeCalls).toEqual([]);
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

  it('checking out shows a receipt, and dismissing it opens a fresh sale', async () => {
    stubBackend({ existingDraft: saleWithMilkLine(42) });
    renderPage();
    await screen.findAllByText('Leche entera 1L');

    await userEvent.click(screen.getByRole('button', { name: /^cobrar$/i }));
    const tendered = await screen.findByLabelText(/importe recibido/i);
    expect(tendered).toHaveValue('1.32');
    await userEvent.click(screen.getByRole('button', { name: /confirmar cobro/i }));

    await screen.findByText(/venta cobrada/i);
    expect(screen.getByText('Efectivo')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /nueva venta/i }));

    await screen.findByText(/el carrito está vacío/i);
    expect(screen.queryByText(/venta cobrada/i)).not.toBeInTheDocument();
  });

  it('"Volver" from checkout returns to the cart without charging', async () => {
    stubBackend({ existingDraft: saleWithMilkLine(42) });
    renderPage();
    await screen.findAllByText('Leche entera 1L');

    await userEvent.click(screen.getByRole('button', { name: /^cobrar$/i }));
    await screen.findByLabelText(/importe recibido/i);
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));

    expect(await screen.findAllByText('Leche entera 1L')).toHaveLength(2);
  });
});
