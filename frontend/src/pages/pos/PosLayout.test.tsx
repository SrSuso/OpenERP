import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PosAuthProvider } from '@/features/auth/PosAuthProvider';
import { POS_TERMINAL_STORAGE_KEY } from '@/features/pos/PosTerminalProvider';

import { PosLayout } from './PosLayout';

const printMocks = vi.hoisted(() => ({ thermal: vi.fn(() => Promise.resolve()) }));

vi.mock('@/features/tickets/qzPrinter', () => ({ printThermalTicket: printMocks.thermal }));

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const ME = {
  id: 1,
  email: 'cajera@example.com',
  full_name: 'Ana',
  role: 'CASHIER',
  permissions: ['pos.access', 'sale.read', 'sale.manage'],
};

const TERMINAL = {
  id: 7,
  name: 'Caja 1',
  warehouse_id: 1,
  warehouse_name: 'Tienda',
  is_active: true,
  created_at: '2026-08-11T09:00:00Z',
};
const TERMINAL_2 = { ...TERMINAL, id: 8, name: 'Caja 2' };

const PREVIEW = {
  covers_from: null,
  sales_count: 3,
  gross_total: '41.800000',
  tax_total: '3.800000',
  discount_total: '0.000000',
  cash_total: '25.000000',
  card_total: '16.800000',
  other_total: '0.000000',
  returns_count: 0,
  returns_total: '0.000000',
  open_sales: [],
};
const DAILY_Z = {
  ...PREVIEW,
  id: 9,
  warehouse_id: 1,
  number: 7,
  closed_at: '2026-08-11T20:00:00Z',
  closed_by_user_id: 1,
};

const PRINT_PROFILE = {
  printable_width_mm: 64,
  margin_left_mm: 8,
  margin_right_mm: 8,
  font_family: 'LIBERATION_MONO',
  font_size_px: 10,
  line_height_px: 14,
  font_weight: 'BOLD',
  margin_top_mm: 2,
  margin_bottom_mm: 3,
};

function stubBackend(
  options: {
    openSales?: { id: number; lines_count: number; total: string }[];
    failFirstClose?: boolean;
    failTerminals?: boolean;
    terminals?: (typeof TERMINAL)[];
    existingDailyZ?: boolean;
  } = {},
) {
  const closeCalls: string[] = [];
  const closeKeys: string[] = [];
  const logoutCalls: string[] = [];
  const ticketCalls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/pos/me')) return Promise.resolve(jsonResponse(ME));
      if (url.includes('/auth/pos/logout')) {
        logoutCalls.push(url);
        // 204 sin cuerpo, como el backend de verdad
        // (backend/app/auth/router.py). Devolviendo `{}` el esquema de
        // `logout()` (z.null()) reventaba y el error salía por consola en
        // cada ejecución del suite, sin que ninguna prueba se enterara.
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes('/settings/values')) return Promise.resolve(jsonResponse({}));
      if (url.includes('/ticket-templates/active/print-profile')) {
        return Promise.resolve(jsonResponse(PRINT_PROFILE));
      }
      if (url.includes('/pos-terminals')) {
        if (options.failTerminals) {
          return Promise.reject(new TypeError('Terminal registry unavailable'));
        }
        return Promise.resolve(jsonResponse(options.terminals ?? [TERMINAL]));
      }
      // La caja pregunta por esta huella cada pocos segundos para saber si
      // el panel ha cambiado algo (ver `useLiveCatalog`).
      if (url.includes('/catalog-version')) {
        return Promise.resolve(jsonResponse({ version: 'v1' }));
      }
      if (url.includes('/warehouses')) {
        return Promise.resolve(jsonResponse([{ id: 1, name: 'Tienda', is_active: true }]));
      }
      if (method === 'POST' && /\/sales\/\d+\/tickets$/.test(url)) {
        ticketCalls.push(url);
        return Promise.resolve(
          jsonResponse({
            id: 12,
            sale_id: 42,
            template_id: 3,
            printable_width_mm: 80,
            margin_left_mm: 0,
            margin_right_mm: 0,
            font_family: 'COURIER_NEW',
            font_size_px: 10,
            line_height_px: 12,
            font_weight: 'NORMAL',
            margin_top_mm: 2,
            margin_bottom_mm: 2,
            rendered_text: 'TICKET ANTERIOR',
            created_at: '2026-08-11T12:00:00Z',
          }),
        );
      }
      if (url.includes('/z-reports/preview')) {
        return Promise.resolve(
          jsonResponse({
            ...PREVIEW,
            open_sales: options.openSales ?? [],
            existing_report: options.existingDailyZ ? DAILY_Z : null,
          }),
        );
      }
      if (method === 'POST' && url.includes('/z-reports')) {
        closeCalls.push(url);
        closeKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        if (options.failFirstClose && closeCalls.length === 1) {
          return Promise.reject(new TypeError('Connection lost after sending request'));
        }
        return Promise.resolve(jsonResponse(DAILY_Z, { status: 201 }));
      }
      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { closeCalls, closeKeys, logoutCalls, ticketCalls };
}

function renderLayout({ configured = true }: { configured?: boolean } = {}) {
  if (configured) window.localStorage.setItem(POS_TERMINAL_STORAGE_KEY, String(TERMINAL.id));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosAuthProvider>
        <MemoryRouter initialEntries={['/pos']}>
          <PosLayout />
        </MemoryRouter>
      </PosAuthProvider>
    </QueryClientProvider>,
  );
}

describe('PosLayout', () => {
  beforeEach(() => {
    window.localStorage.clear();
    printMocks.thermal.mockClear();
  });

  it('requires an explicit terminal selection and persists it for later logins', async () => {
    stubBackend();
    renderLayout({ configured: false });

    expect(
      await screen.findByRole('heading', { name: 'Seleccionar terminal' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: /Caja 1/ }));

    expect(await screen.findByRole('button', { name: 'Caja 1' })).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('7');
  });

  it('shows an explicit error when the terminal registry cannot be loaded', async () => {
    stubBackend({ failTerminals: true });
    renderLayout({ configured: false });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no se han podido cargar los terminales/i,
    );
  });

  it('blocks an inactive stored terminal without discarding its identity', async () => {
    stubBackend({ terminals: [] });
    renderLayout();

    expect(await screen.findByText(/terminal configurado ya no está activo/i)).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('7');
  });

  it('changes terminal only after an explicit choice', async () => {
    stubBackend({ terminals: [TERMINAL, TERMINAL_2] });
    renderLayout();
    const current = await screen.findByRole('button', { name: 'Caja 1' });

    await userEvent.click(current);
    expect(screen.getByRole('heading', { name: 'Seleccionar terminal' })).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('7');
    await userEvent.click(screen.getByRole('button', { name: /Caja 2/ }));

    expect(await screen.findByRole('button', { name: 'Caja 2' })).toBeInTheDocument();
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('8');
  });

  it('enters and exits browser fullscreen from the POS header', async () => {
    stubBackend();
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });

    renderLayout();
    const fullscreenButton = await screen.findByRole('button', { name: 'Pantalla completa' });
    await userEvent.click(fullscreenButton);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    fullscreenElement = document.documentElement;
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(
      await screen.findByRole('button', { name: 'Salir de pantalla completa' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Salir de pantalla completa' }));
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('does not expose a quick reprint button for the last ticket', async () => {
    stubBackend();
    window.localStorage.setItem('openerp.pos.lastTicketSaleId.7', '42');
    renderLayout();

    await screen.findByRole('link', { name: 'Tickets' });
    expect(
      screen.queryByRole('button', { name: 'Reimprimir último ticket' }),
    ).not.toBeInTheDocument();
  });

  it('signs out the cashier without closing the till or discarding its terminal', async () => {
    const backend = stubBackend();
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    await waitFor(() => expect(backend.logoutCalls).toHaveLength(1));
    expect(screen.queryByRole('dialog', { name: 'Cierre de caja' })).not.toBeInTheDocument();
    expect(backend.closeCalls).toEqual([]);
    // El terminal es de este navegador, no de Ana: el próximo cajero retoma
    // la misma caja y su periodo Z todavía abierto.
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('7');
  });

  it('closes and prints the Z without signing out the cashier', async () => {
    const backend = stubBackend();
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cierre Z' }));
    await screen.findByRole('dialog', { name: 'Cierre de caja' });
    expect(await screen.findByText('41,80 €')).toBeInTheDocument();
    expect(screen.getByText('25,00 €')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar caja e imprimir Z' }));

    // La Z queda guardada y con su número, pero el cajero sigue en el TPV.
    expect(await screen.findByText('Cierre Z nº 7')).toBeInTheDocument();
    expect(backend.closeCalls).toHaveLength(1);
    expect(backend.logoutCalls).toEqual([]);
    await waitFor(() => expect(printMocks.thermal).toHaveBeenCalledTimes(1));
    expect(printMocks.thermal).toHaveBeenCalledWith(
      expect.stringContaining('CIERRE Z'),
      PRINT_PROFILE,
      expect.any(Object),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Volver al TPV' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(backend.logoutCalls).toEqual([]);
    expect(window.localStorage.getItem(POS_TERMINAL_STORAGE_KEY)).toBe('7');
  });

  it('reprints an existing daily Z without creating another one', async () => {
    const backend = stubBackend({ existingDailyZ: true });
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cierre Z' }));

    expect(await screen.findByText('Cierre Z nº 7')).toBeInTheDocument();
    expect(
      screen.getByText(
        'La Z diaria ya existe. Actualízala para incorporar los cobros y devoluciones posteriores.',
      ),
    ).toBeInTheDocument();
    expect(backend.closeCalls).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Reimprimir Z' }));
    await waitFor(() => expect(printMocks.thermal).toHaveBeenCalledTimes(1));
  });

  it('updates the existing daily Z instead of creating another one', async () => {
    const backend = stubBackend({ existingDailyZ: true });
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cierre Z' }));
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar Z e imprimir' }));

    expect(await screen.findByText('Cierre Z nº 7')).toBeInTheDocument();
    expect(backend.closeCalls).toHaveLength(1);
    await waitFor(() => expect(printMocks.thermal).toHaveBeenCalledTimes(1));
  });

  it('says which sales are in the way, not just how many', async () => {
    // "Hay una venta sin cobrar" a secas deja sin salida a quien está en el
    // mostrador: no sabe cuál buscar.
    stubBackend({
      openSales: [
        { id: 12, lines_count: 3, total: '8.400000' },
        { id: 15, lines_count: 1, total: '1.200000' },
      ],
    });
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cierre Z' }));

    expect(await screen.findByText(/2 ventas sin cobrar/)).toBeInTheDocument();
    expect(screen.getByText(/Venta #12 — 3 líneas · 8,40 €/)).toBeInTheDocument();
    expect(screen.getByText(/Venta #15 — 1 línea · 1,20 €/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar caja e imprimir Z' })).toBeDisabled();
  });

  it('reuses the Z idempotency key after an uncertain transport error', async () => {
    const backend = stubBackend({ failFirstClose: true });
    renderLayout();
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cierre Z' }));
    const closeButton = await screen.findByRole('button', { name: 'Cerrar caja e imprimir Z' });
    await userEvent.click(closeButton);
    await screen.findByText('No se ha podido cerrar la caja.');
    await userEvent.click(closeButton);

    await screen.findByText('Cierre Z nº 7');
    await waitFor(() => expect(backend.closeKeys).toHaveLength(2));
    expect(backend.closeKeys[0]).not.toBe('');
    expect(backend.closeKeys[1]).toBe(backend.closeKeys[0]);
  });
});
