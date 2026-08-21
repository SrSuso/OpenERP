import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type Sale, type Tender } from '@/features/pos/api';
import { PosHeaderActionsProvider } from '@/features/pos/PosHeaderActions';
import { usePosHeaderActions } from '@/features/pos/PosHeaderActionsContext';
import { POS_TERMINAL_STORAGE_KEY, PosTerminalProvider } from '@/features/pos/PosTerminalProvider';

import { PosHomePage } from './PosHomePage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const WAREHOUSE = { id: 1, name: 'Tienda principal', is_active: true };
const LOCATION = { id: 1, warehouse_id: 1, name: 'Almacén', is_active: true };
const TERMINAL = {
  id: 7,
  name: 'Caja 1',
  warehouse_id: 1,
  warehouse_name: 'Tienda principal',
  is_active: true,
  created_at: '2026-08-11T09:00:00Z',
};
const POS_CATEGORY = {
  id: 1,
  name: 'Bebidas',
  color: '#3b82f6',
  display_order: 0,
  is_active: true,
};
/** Su categoría lo vende pesando: un toque no puede venderlo, tiene que preguntar. */
const TOMATO = {
  id: 2,
  sku: 'TOMATE',
  name: 'Tomate',
  pos_category_id: 1,
  pos_category_name: 'Bebidas',
  is_sold_by_weight: true,
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
      barcodes: [{ id: 200, barcode: '2000000000015' }],
    },
  ],
};
const MILK = {
  id: 1,
  sku: 'LECHE-1L',
  name: 'Leche entera 1L',
  pos_category_id: 1,
  pos_category_name: 'Bebidas',
  is_sold_by_weight: false,
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
    {
      id: 11,
      name: 'Caja 6',
      factor: '6.000000',
      is_base: false,
      barcodes: [{ id: 101, barcode: '8410000000065' }],
    },
  ],
};
const DELI_TOTAL = {
  id: 3,
  sku: 'CHARCUTERIA',
  name: 'Charcutería',
  pos_category_id: 1,
  pos_category_name: 'Bebidas',
  is_open_price: true,
  is_sold_by_weight: false,
  base_unit_name: 'UNIDAD',
  list_price: '0.000000',
  tax_rate: '10.000000',
  is_active: true,
  packages: [
    {
      id: 30,
      name: 'UNIDAD',
      factor: '1.000000',
      is_base: true,
      barcodes: [],
    },
  ],
};

function emptySale(id: number): Sale {
  return {
    id,
    warehouse_id: 1,
    location_id: 1,
    terminal_id: TERMINAL.id,
    terminal_name: TERMINAL.name,
    status: 'DRAFT',
    number: null,
    notes: '',
    created_at: '2026-08-11T10:00:00Z',
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
    terminal_id: TERMINAL.id,
    terminal_name: TERMINAL.name,
    status: 'DRAFT',
    number: null,
    notes: '',
    created_at: '2026-08-11T10:00:00Z',
    lines: [
      {
        id: 900,
        product_id: 1,
        product_sku: 'LECHE-1L',
        product_name: 'Leche entera 1L',
        package_id: 10,
        package_name: 'Brick',
        package_factor: '1.000000',
        quantity_packages: '1.000000',
        quantity_base: '1.000000',
        quantity_refunded: '0.000000',
        quantity_physically_returned: '0.000000',
        tracks_stock: true,
        track_lots: false,
        package_price: '1.200000',
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
function stubBackend(
  options: {
    existingDraft?: Sale;
    checkoutFailures?: number;
    holdCheckout?: boolean;
    rejectLineOnce?: boolean;
    showProductSearch?: boolean;
  } = {},
) {
  let sale: Sale | null = options.existingDraft ?? null;
  let nextSaleId = 5;
  const postSalesCalls = { count: 0 };
  const postSalesBodies: Record<string, unknown>[] = [];
  const addLineCalls: Record<string, unknown>[] = [];
  const barcodeLineCalls: Record<string, unknown>[] = [];
  const barcodeCalls: string[] = [];
  const checkoutKeys: string[] = [];
  let remainingCheckoutFailures = options.checkoutFailures ?? 0;
  let remainingLineFailures = options.rejectLineOnce ? 1 : 0;
  const mutationTerminalHeaders: string[] = [];
  const terminal = { ...TERMINAL, show_product_search: options.showProductSearch ?? true };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (method !== 'GET' && /\/sales\/\d+/.test(url)) {
        mutationTerminalHeaders.push(new Headers(init?.headers).get('X-POS-Terminal-ID') ?? '');
      }

      if (url.includes('/pos-terminals')) {
        return Promise.resolve(jsonResponse([terminal]));
      }
      if (url.includes('/warehouses/1/locations')) {
        return Promise.resolve(jsonResponse([LOCATION]));
      }
      if (url.includes('/warehouses')) {
        return Promise.resolve(jsonResponse([WAREHOUSE]));
      }
      if (url.includes('/pos-categories')) {
        return Promise.resolve(jsonResponse([POS_CATEGORY]));
      }
      const lookup = /\/products\/barcode\/(.+)$/.exec(url);
      if (method === 'GET' && lookup) {
        barcodeCalls.push(decodeURIComponent(lookup[1]!));
        const found = [MILK, TOMATO].find((product) =>
          product.packages.some((pkg) => pkg.barcodes.some((b) => b.barcode === lookup[1])),
        );
        if (!found) return Promise.resolve(jsonResponse({}, { status: 404 }));
        return Promise.resolve(jsonResponse(found));
      }
      if (url.includes('/products')) {
        const search = new URL(url, 'http://test').searchParams.get('search')?.toLowerCase();
        const catalog = [MILK, TOMATO, DELI_TOTAL];
        return Promise.resolve(
          jsonResponse(
            search
              ? catalog.filter((product) => product.name.toLowerCase().includes(search))
              : catalog,
          ),
        );
      }
      if (url.includes('/sales') && url.includes('status=DRAFT')) {
        return Promise.resolve(jsonResponse(sale ? [sale] : []));
      }
      if (method === 'POST' && /\/sales\/\d+\/checkout$/.test(url)) {
        checkoutKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        if (options.holdCheckout) {
          return new Promise<Response>(() => undefined);
        }
        if (remainingCheckoutFailures > 0) {
          remainingCheckoutFailures -= 1;
          return Promise.reject(new TypeError('Network request failed'));
        }
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
          number: null,
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
        postSalesBodies.push(
          init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
        );
        sale = emptySale(nextSaleId++);
        return Promise.resolve(jsonResponse(sale, { status: 201 }));
      }
      if (method === 'POST' && /\/sales\/\d+\/lines\/by-barcode$/.test(url)) {
        const body = init?.body
          ? (JSON.parse(init.body as string) as {
              barcode: string;
              quantity_packages: string;
            })
          : { barcode: '', quantity_packages: '1' };
        barcodeLineCalls.push(body);
        const product = [MILK, TOMATO].find((candidate) =>
          candidate.packages.some((pkg) =>
            pkg.barcodes.some((entry) => entry.barcode === body.barcode),
          ),
        );
        const pkg = product?.packages.find((candidate) =>
          candidate.barcodes.some((entry) => entry.barcode === body.barcode),
        );
        if (!product || !pkg) return Promise.resolve(jsonResponse({}, { status: 404 }));

        const targetId = Number(/\/sales\/(\d+)\/lines\/by-barcode$/.exec(url)![1]);
        const quantity = Number(body.quantity_packages);
        const factor = Number(pkg.factor);
        const unitPrice = Number(product.list_price);
        const existingLines = sale?.id === targetId ? sale.lines : [];
        const existing = existingLines.find((line) => line.package_id === pkg.id);
        const quantityPackages = quantity + (existing ? Number(existing.quantity_packages) : 0);
        const quantityBase = quantityPackages * factor;
        const lineTotal = quantityBase * unitPrice;
        const line = {
          id: existing?.id ?? 901,
          product_id: product.id,
          product_sku: product.sku,
          product_name: product.name,
          package_id: pkg.id,
          package_name: pkg.name,
          package_factor: factor.toFixed(6),
          quantity_packages: quantityPackages.toFixed(6),
          quantity_base: quantityBase.toFixed(6),
          quantity_refunded: '0.000000',
          quantity_physically_returned: '0.000000',
          tracks_stock: true,
          track_lots: false,
          package_price: (factor * unitPrice).toFixed(6),
          unit_price: unitPrice.toFixed(6),
          tax_rate: product.tax_rate,
          discount_rate: '0.000000',
          subtotal: lineTotal.toFixed(6),
          discount_amount: '0.000000',
          tax_amount: '0.000000',
          total: lineTotal.toFixed(6),
        };
        const lines = existing
          ? existingLines.map((candidate) => (candidate.package_id === pkg.id ? line : candidate))
          : [...existingLines, line];
        sale = {
          ...emptySale(targetId),
          lines,
          total: lines.reduce((total, candidate) => total + Number(candidate.total), 0).toFixed(6),
        };
        return Promise.resolve(jsonResponse(sale, { status: 201 }));
      }
      if (method === 'POST' && /\/sales\/\d+\/lines$/.test(url)) {
        if (remainingLineFailures > 0) {
          remainingLineFailures -= 1;
          return Promise.resolve(
            jsonResponse(
              {
                error: {
                  code: 'conflict',
                  message: 'La venta pertenece a otro terminal POS.',
                  details: {},
                },
              },
              { status: 409 },
            ),
          );
        }
        addLineCalls.push(
          init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
        );
        // Sobre la venta que dice la URL, no sobre "la última": con varias
        // abiertas a la vez son cosas distintas.
        const targetId = Number(/\/sales\/(\d+)\/lines$/.exec(url)![1]);
        sale = saleWithMilkLine(targetId);
        return Promise.resolve(jsonResponse(sale, { status: 201 }));
      }
      if (method === 'DELETE' && /\/sales\/\d+\/lines\/\d+$/.test(url)) {
        sale = sale ? emptySale(sale.id) : null;
        return Promise.resolve(jsonResponse(sale));
      }
      if (method === 'POST' && /\/sales\/\d+\/cancel$/.test(url)) {
        // Cancelar borra el carrito: no devuelve venta porque ya no la hay.
        sale = null;
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return {
    postSalesCalls,
    postSalesBodies,
    addLineCalls,
    barcodeLineCalls,
    barcodeCalls,
    checkoutKeys,
    mutationTerminalHeaders,
  };
}

function renderPage() {
  window.localStorage.setItem(POS_TERMINAL_STORAGE_KEY, String(TERMINAL.id));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosTerminalProvider>
        <PosHeaderActionsProvider>
          <HeaderNewSaleButton />
          <PosHomePage />
        </PosHeaderActionsProvider>
      </PosTerminalProvider>
    </QueryClientProvider>,
  );
}

/** El layout real coloca esta acción junto al nombre del TPV. En esta prueba
 * de la pantalla aislada basta con exponer el mismo registro para probar que
 * abrir otra venta conserva los borradores existentes. */
function HeaderNewSaleButton() {
  const { newSaleAction } = usePosHeaderActions();
  if (!newSaleAction) return null;
  return (
    <button type="button" disabled={newSaleAction.disabled} onClick={newSaleAction.onPress}>
      Nueva venta
    </button>
  );
}

/** El lector sólo escucha con una venta activa y sin nada en vuelo, que es
 * justo cuando el recuadro de códigos deja de estar deshabilitado: esperar
 * a eso es esperar a la condición de verdad, y no a algo que se pinta
 * antes. */
async function waitForScannerReady() {
  await waitFor(() =>
    expect(screen.getByPlaceholderText('Escanear o introducir código de barras')).toBeEnabled(),
  );
  // `waitFor` mira el DOM ya pintado, pero quien engancha la escucha del
  // lector es un efecto, y los efectos corren después de pintar. Sin vaciar
  // la cola, con la máquina cargada las teclas podían llegar antes que el
  // oyente y perderse.
  await act(async () => {});
}

/** Teclea un código como lo haría un lector, con el reloj congelado.
 *
 * El hook distingue el lector del tecleo por lo que tarda entre teclas, así
 * que dejarlo al reloj de verdad hace la prueba dependiente de lo cargada
 * que esté la máquina: un tirón de 120 ms entre dos `fireEvent` y ya no
 * parece un escaneo. Aquí el tiempo lo decide la prueba. */
function scan(
  code: string,
  options: { terminator?: 'Enter' | 'Tab'; gapMs?: number; idleAfter?: boolean } = {},
) {
  const { terminator, gapMs = 15, idleAfter = false } = options;
  vi.useFakeTimers({ shouldAdvanceTime: false });
  try {
    for (const key of code) {
      fireEvent.keyDown(document, { key });
      vi.advanceTimersByTime(gapMs);
    }
    if (terminator) fireEvent.keyDown(document, { key: terminator });
    // Sin terminador: el escaneo se cierra solo al dejar de llegar teclas.
    if (idleAfter) vi.advanceTimersByTime(500);
  } finally {
    vi.useRealTimers();
  }
}

describe('PosHomePage', () => {
  it('opens a new draft sale when the till has none open, then lets the cashier tap a product onto it', async () => {
    const backend = stubBackend();
    renderPage();

    const productButton = await screen.findByRole('button', { name: /leche entera 1l/i });
    expect(backend.postSalesCalls.count).toBe(1);
    expect(backend.postSalesBodies[0]).toMatchObject({ terminal_id: TERMINAL.id });
    expect(screen.getByText(/el carrito está vacío/i)).toBeInTheDocument();

    await userEvent.click(productButton);

    expect(await screen.findAllByText('Leche entera 1L')).toHaveLength(2);
    const cart = screen.getByRole('button', { name: /cancelar venta/i }).closest('aside')!;
    expect(within(cart).getByText('Leche entera 1L')).toBeInTheDocument();
    expect(within(cart).getAllByText('1,32 €').length).toBeGreaterThan(0);
  });

  it('finds a product from the touch search and adds the selected result', async () => {
    const backend = stubBackend();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Buscar producto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Buscar productos' });
    await userEvent.type(within(dialog).getByLabelText('Nombre, referencia o código'), 'Leche');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Leche entera 1L/ }));

    await waitFor(() => {
      expect(backend.addLineCalls).toContainEqual({
        product_id: 1,
        package_id: 10,
        quantity_packages: '1',
      });
    });
    expect(screen.queryByRole('dialog', { name: 'Buscar productos' })).not.toBeInTheDocument();
  });

  it('hides the touch search when that terminal has it disabled', async () => {
    stubBackend({ showProductSearch: false });
    renderPage();

    await waitForScannerReady();
    expect(screen.queryByRole('button', { name: 'Buscar producto' })).not.toBeInTheDocument();
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
    expect(backend.mutationTerminalHeaders).toContain(String(TERMINAL.id));
  });

  it('asks for the final total before adding an open-price deli button', async () => {
    const backend = stubBackend();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /charcutería/i }));

    const dialog = await screen.findByRole('dialog', { name: /importe de charcutería/i });
    expect(backend.addLineCalls).toEqual([]);
    await userEvent.type(within(dialog).getByLabelText('Importe total'), '12,50');
    expect(within(dialog).getByText('12,50 €')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Añadir al carrito' }));

    expect(backend.addLineCalls).toEqual([
      { product_id: 3, package_id: 30, quantity_packages: '1', open_price_total: '12.50' },
    ]);
  });

  it('shows a semantic backend rejection instead of applying a foreign-terminal mutation', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42), rejectLineOnce: true });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /leche entera 1l/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La venta pertenece a otro terminal POS.',
    );
    expect(backend.addLineCalls).toEqual([]);
    expect(backend.mutationTerminalHeaders).toEqual([String(TERMINAL.id)]);
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

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva venta' }));

    expect(backend.postSalesCalls.count).toBe(1);
    // Las dos siguen abiertas y se puede volver a la primera.
    const first = await screen.findByRole('button', { name: /Venta 1/ });
    const second = screen.getByRole('button', { name: /Venta 2/ });
    expect(second).toHaveAttribute('aria-current', 'true');

    await userEvent.click(first);
    expect(first).toHaveAttribute('aria-current', 'true');
  });

  it('keeps every open sale up to date, not just the one on screen', async () => {
    // Lo que pasaba: la barra de arriba pintaba cada venta con lo que tenía
    // al cargar la pantalla, así que al volver a una faltaban los productos
    // que ya se le habían metido y el total no era el suyo.
    stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await screen.findByRole('button', { name: /cancelar venta/i });

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva venta' }));
    const first = await screen.findByRole('button', { name: /Venta 1/ });

    // Se le mete un producto a la segunda…
    await userEvent.click(screen.getByRole('button', { name: /leche entera 1l/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Venta 2/ })).toHaveTextContent('1 línea'),
    );

    // …se vuelve a la primera y de nuevo a la segunda: lo suyo sigue ahí.
    await userEvent.click(first);
    await userEvent.click(screen.getByRole('button', { name: /Venta 2/ }));

    const cart = screen.getByRole('button', { name: /cancelar venta/i }).closest('aside')!;
    expect(within(cart).getByText('Leche entera 1L')).toBeInTheDocument();
  });

  it('reads a scanned barcode without clicking into the box first', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await waitForScannerReady();

    // Un lector teclea el código entero de golpe y termina con Intro, sin
    // que nadie haya pinchado en ningún sitio.
    scan('8410000000010', { terminator: 'Enter' });

    await waitFor(() =>
      expect(backend.barcodeLineCalls).toEqual([
        { barcode: '8410000000010', quantity_packages: '1' },
      ]),
    );
    const cart = screen.getByRole('button', { name: /cancelar venta/i }).closest('aside')!;
    expect(within(cart).getByText(/1 × brick/i)).toHaveTextContent('1,20 €');
  });

  it('keeps the exact box presentation and price returned by the barcode endpoint', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await waitForScannerReady();

    scan('8410000000065', { terminator: 'Enter' });

    await waitFor(() =>
      expect(backend.barcodeLineCalls).toEqual([
        { barcode: '8410000000065', quantity_packages: '1' },
      ]),
    );
    expect(backend.addLineCalls).toEqual([]);
    const cart = screen.getByRole('button', { name: /cancelar venta/i }).closest('aside')!;
    expect(within(cart).getByText(/1 × caja 6/i)).toBeInTheDocument();
    expect(within(cart).getByText(/6 uds\. base/i)).toBeInTheDocument();
    expect(within(cart).getAllByText('7,20 €').length).toBeGreaterThan(0);
  });

  it('asks for the grams when what was scanned is sold by weight', async () => {
    // Escanear no puede saltarse la regla del peso: por código entraba un
    // kilo en silencio.
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await waitForScannerReady();

    scan('2000000000015', { terminator: 'Enter' });

    expect(await screen.findByRole('dialog', { name: /cantidad de tomate/i })).toBeInTheDocument();
    expect(backend.addLineCalls).toEqual([]);
    expect(backend.barcodeLineCalls).toEqual([]);
    expect(backend.barcodeCalls).toEqual(['2000000000015']);

    const dialog = screen.getByRole('dialog', { name: /cantidad de tomate/i });
    await userEvent.type(within(dialog).getByLabelText('Gramos'), '500');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Añadir' }));
    expect(backend.barcodeLineCalls).toEqual([
      { barcode: '2000000000015', quantity_packages: '0.500' },
    ]);
  });

  it('applies the typed quantity to what was scanned', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await waitForScannerReady();

    await userEvent.click(screen.getByRole('button', { name: '3' }));
    scan('8410000000010', { terminator: 'Enter' });

    await waitFor(() =>
      expect(backend.barcodeLineCalls).toEqual([
        { barcode: '8410000000010', quantity_packages: '3' },
      ]),
    );
    expect(backend.addLineCalls).toEqual([]);
  });

  it('merges two consecutive box scans as two boxes and twelve base units', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await waitForScannerReady();

    scan('8410000000065', { terminator: 'Enter' });
    await waitFor(() => expect(backend.barcodeLineCalls).toHaveLength(1));
    await waitForScannerReady();
    scan('8410000000065', { terminator: 'Enter' });

    await waitFor(() => expect(backend.barcodeLineCalls).toHaveLength(2));
    const cart = screen.getByRole('button', { name: /cancelar venta/i }).closest('aside')!;
    expect(within(cart).getByText(/2 × caja 6/i)).toBeInTheDocument();
    expect(within(cart).getByText(/6 uds\. base/i)).toBeInTheDocument();
    expect(within(cart).getAllByText('14,40 €').length).toBeGreaterThan(0);
  });

  it('leaves the cart unchanged and clears an unknown barcode for the next scan', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    const input = await screen.findByPlaceholderText('Escanear o introducir código de barras');

    await userEvent.type(input, 'NO-EXISTE');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El código NO-EXISTE no está dado de alta en ningún producto.',
    );
    expect(input).toHaveValue('');
    expect(input).toBeEnabled();
    expect(screen.getByText(/el carrito está vacío/i)).toBeInTheDocument();
    expect(backend.barcodeLineCalls).toEqual([]);
  });

  it('reads a slower scanner too, and one that sends no Enter at all', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await waitForScannerReady();

    // 80 ms por carácter (un lector por Bluetooth de los lentos) y sin
    // Intro ni Tab: muchos vienen de fábrica sin sufijo configurado.
    scan('8410000000010', { gapMs: 80, idleAfter: true });

    await waitFor(() => expect(backend.barcodeCalls).toEqual(['8410000000010']));
  });

  it('accepts Tab as the terminator, which many scanners send instead', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await waitForScannerReady();

    scan('8410000000010', { terminator: 'Tab' });

    await waitFor(() => expect(backend.barcodeCalls).toEqual(['8410000000010']));
  });

  it('ignores slow typing outside a field: that is not a scanner', async () => {
    const backend = stubBackend({ existingDraft: emptySale(42) });
    renderPage();
    await waitForScannerReady();

    scan('8410', { gapMs: 200, terminator: 'Enter' });

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
    await userEvent.click(screen.getByRole('button', { name: /confirmar cobro/i }));
    const cashPrompt = await screen.findByRole('dialog', { name: 'Importe recibido' });
    expect(within(cashPrompt).getByLabelText('Importe recibido')).toHaveValue('0,00 €');
    await userEvent.click(within(cashPrompt).getByRole('button', { name: 'Confirmar efectivo' }));

    await screen.findByText(/venta cobrada/i);
    expect(screen.getByText('Efectivo')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /nueva venta/i }));

    await screen.findByText(/el carrito está vacío/i);
    expect(screen.queryByText(/venta cobrada/i)).not.toBeInTheDocument();
  });

  it('reuses the same idempotency key after an uncertain checkout error', async () => {
    const backend = stubBackend({ existingDraft: saleWithMilkLine(42), checkoutFailures: 1 });
    renderPage();
    await screen.findAllByText('Leche entera 1L');

    await userEvent.click(screen.getByRole('button', { name: /^cobrar$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar cobro/i }));
    const cashPrompt = await screen.findByRole('dialog', { name: 'Importe recibido' });
    await userEvent.click(within(cashPrompt).getByRole('button', { name: 'Confirmar efectivo' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar efectivo' }));

    await screen.findByText(/venta cobrada/i);
    expect(backend.checkoutKeys).toHaveLength(2);
    expect(backend.checkoutKeys[0]).not.toBe('');
    expect(backend.checkoutKeys[1]).toBe(backend.checkoutKeys[0]);
  });

  it('uses a new key after leaving checkout and starting a new intention', async () => {
    const backend = stubBackend({ existingDraft: saleWithMilkLine(42), checkoutFailures: 2 });
    renderPage();
    await screen.findAllByText('Leche entera 1L');

    await userEvent.click(screen.getByRole('button', { name: /^cobrar$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar cobro/i }));
    let cashPrompt = await screen.findByRole('dialog', { name: 'Importe recibido' });
    await userEvent.click(within(cashPrompt).getByRole('button', { name: 'Confirmar efectivo' }));
    await screen.findByRole('alert');
    // Primero cierra el recuadro de efectivo y luego abandona realmente el
    // checkout: el intento siguiente debe generar otra idempotency key.
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cobrar$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar cobro/i }));
    cashPrompt = await screen.findByRole('dialog', { name: 'Importe recibido' });
    await userEvent.click(within(cashPrompt).getByRole('button', { name: 'Confirmar efectivo' }));
    await screen.findByRole('alert');

    expect(backend.checkoutKeys).toHaveLength(2);
    expect(backend.checkoutKeys[1]).not.toBe(backend.checkoutKeys[0]);
  });

  it('turns a rapid double click into one checkout intention', async () => {
    const backend = stubBackend({ existingDraft: saleWithMilkLine(42), holdCheckout: true });
    renderPage();
    await screen.findAllByText('Leche entera 1L');

    await userEvent.click(screen.getByRole('button', { name: /^cobrar$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar cobro/i }));
    const cashPrompt = await screen.findByRole('dialog', { name: 'Importe recibido' });
    const confirm = within(cashPrompt).getByRole('button', { name: 'Confirmar efectivo' });
    await userEvent.dblClick(confirm);

    await waitFor(() => expect(backend.checkoutKeys).toHaveLength(1));
    expect(backend.checkoutKeys[0]).not.toBe('');
    expect(within(cashPrompt).getByRole('button', { name: /cobrando/i })).toBeDisabled();
  });

  it('"Volver" from checkout returns to the cart without charging', async () => {
    stubBackend({ existingDraft: saleWithMilkLine(42) });
    renderPage();
    await screen.findAllByText('Leche entera 1L');

    await userEvent.click(screen.getByRole('button', { name: /^cobrar$/i }));
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));

    expect(await screen.findAllByText('Leche entera 1L')).toHaveLength(2);
  });
});
