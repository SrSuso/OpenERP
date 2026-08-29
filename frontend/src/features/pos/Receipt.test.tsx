import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const printMocks = vi.hoisted(() => ({
  thermal: vi.fn(() => Promise.resolve()),
  drawer: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/features/tickets/qzPrinter', () => ({
  printThermalTicket: printMocks.thermal,
  openCashDrawer: printMocks.drawer,
}));

import { Receipt } from './Receipt';
import { type Sale } from './api';

const PAID_SALE: Sale = {
  id: 1,
  warehouse_id: 1,
  location_id: 1,
  terminal_id: 7,
  terminal_name: 'Caja 1',
  status: 'COMPLETED',
  number: null,
  notes: '',
  created_at: '2026-08-11T10:00:00Z',
  lines: [],
  total: '20.000000',
  payments: [{ id: 1, method: 'CASH', amount: '50.000000', created_at: '2026-08-08T10:00:00Z' }],
  change_due: '30.000000',
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function renderReceipt(overrides: Partial<Parameters<typeof Receipt>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Receipt sale={PAID_SALE} onDismiss={vi.fn()} {...overrides} />
    </QueryClientProvider>,
  );
}

/** Distingue los dos endpoints que toca esta pantalla: los ajustes de la
 * tienda y la generación del ticket. */
function stubBackend(values: Record<string, string>) {
  const ticketCalls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/settings/values')) return Promise.resolve(jsonResponse(values));
      if ((init?.method ?? 'GET') === 'POST' && url.includes('/tickets')) {
        ticketCalls.push(url);
        return Promise.resolve(
          jsonResponse(
            {
              id: 1,
              sale_id: 1,
              template_id: 1,
              printable_width_mm: 48,
              margin_left_mm: 16,
              margin_right_mm: 16,
              font_family: 'COURIER_NEW',
              font_size_px: 9,
              line_height_px: 12,
              font_weight: 'NORMAL',
              margin_top_mm: 0,
              margin_bottom_mm: 0,
              rendered_text: 'Venta #1\nTOTAL 20.00\n',
              created_at: '2026-08-08T10:00:00Z',
            },
            { status: 201 },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch to ${url} in test`));
    }),
  );
  return { ticketCalls };
}

describe('Receipt', () => {
  beforeEach(() => {
    printMocks.thermal.mockReset().mockResolvedValue(undefined);
    printMocks.drawer.mockReset().mockResolvedValue(undefined);
  });

  it('shows the total charged', () => {
    renderReceipt();

    expect(screen.getByText('20,00 €')).toBeInTheDocument();
  });

  it('lists each payment by method', () => {
    renderReceipt();

    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('50,00 €')).toBeInTheDocument();
  });

  it('opens the cash drawer through QZ after a cash sale', async () => {
    stubBackend({ 'pos.print_ticket_on_checkout': 'false' });
    renderReceipt();

    await waitFor(() => expect(printMocks.drawer).toHaveBeenCalledTimes(1));
    expect(printMocks.drawer).toHaveBeenCalledWith(
      expect.objectContaining({ printerName: 'POSPrinter POS-80' }),
    );
  });

  it('does not open the drawer for a card-only sale', async () => {
    stubBackend({ 'pos.print_ticket_on_checkout': 'false' });
    renderReceipt({
      sale: {
        ...PAID_SALE,
        payments: [
          { id: 2, method: 'CARD', amount: '20.000000', created_at: PAID_SALE.created_at },
        ],
        change_due: '0.000000',
      },
    });

    await screen.findByText('Venta cobrada');
    expect(printMocks.drawer).not.toHaveBeenCalled();
  });

  it('shows the change due when there is any', () => {
    renderReceipt();

    expect(screen.getByText(/cambio a entregar/i)).toBeInTheDocument();
    expect(screen.getByText('30,00 €')).toBeInTheDocument();
  });

  it('hides the change block for an exact payment', () => {
    renderReceipt({ sale: { ...PAID_SALE, change_due: '0.000000' } });

    expect(screen.queryByText(/cambio a entregar/i)).not.toBeInTheDocument();
  });

  it('calls onDismiss when "Nueva venta" is tapped', async () => {
    const onDismiss = vi.fn();
    renderReceipt({ onDismiss });

    await userEvent.click(screen.getByRole('button', { name: /nueva venta/i }));

    expect(onDismiss).toHaveBeenCalled();
  });

  it('generates the ticket and sends the exact frozen text to QZ Tray', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {
              id: 1,
              sale_id: 1,
              template_id: 1,
              printable_width_mm: 48,
              margin_left_mm: 16,
              margin_right_mm: 16,
              font_family: 'COURIER_NEW',
              font_size_px: 9,
              line_height_px: 12,
              font_weight: 'NORMAL',
              margin_top_mm: 0,
              margin_bottom_mm: 0,
              rendered_text: 'Venta #1\nTOTAL 20.00\n',
              created_at: '2026-08-08T10:00:00Z',
            },
            { status: 201 },
          ),
        ),
      ),
    );
    renderReceipt();

    await userEvent.click(screen.getByRole('button', { name: /imprimir ticket/i }));

    await waitFor(() =>
      expect(printMocks.thermal).toHaveBeenCalledWith(
        'Venta #1\nTOTAL 20.00\n',
        expect.objectContaining({ printable_width_mm: 48 }),
        expect.any(Object),
      ),
    );
  });

  it('prints on its own as soon as the sale is charged', async () => {
    // En una caja con cola detrás, un botón más por cliente son cientos de
    // pulsaciones al mes.
    const backend = stubBackend({});
    renderReceipt();

    await waitFor(() => expect(printMocks.thermal).toHaveBeenCalledTimes(1));
    // Una sola vez: generar el ticket es idempotente, pero pedirlo dos
    // veces mandaría dos trabajos a la impresora.
    expect(backend.ticketCalls).toHaveLength(1);
  });

  it('goes back to a new sale on its own once the ticket is out', async () => {
    // Sin darle a nada: en una caja con cola detrás, un botón por cliente
    // son cientos de pulsaciones al mes.
    stubBackend({});
    const onDismiss = vi.fn();
    renderReceipt({ onDismiss });

    await waitFor(() => expect(printMocks.thermal).toHaveBeenCalled());
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });

  it('stays put when the ticket was asked for by hand', async () => {
    // Si alguien lo ha pedido, es porque quería mirarlo.
    stubBackend({ 'pos.print_ticket_on_checkout': 'false' });
    const onDismiss = vi.fn();
    renderReceipt({ onDismiss });
    await screen.findByText('20,00 €');

    await userEvent.click(screen.getByRole('button', { name: /imprimir ticket/i }));

    await waitFor(() => expect(printMocks.thermal).toHaveBeenCalledTimes(1));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('waits for the button when the shop turned auto-printing off', async () => {
    const backend = stubBackend({ 'pos.print_ticket_on_checkout': 'false' });
    renderReceipt();
    await screen.findByText('20,00 €');

    expect(printMocks.thermal).not.toHaveBeenCalled();
    expect(backend.ticketCalls).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: /imprimir ticket/i }));

    await waitFor(() => expect(printMocks.thermal).toHaveBeenCalled());
  });

  it('shows an error if generating the ticket fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            { error: { code: 'validation_error', message: 'No hay plantilla activa.' } },
            { status: 422 },
          ),
        ),
      ),
    );
    renderReceipt();

    await userEvent.click(screen.getByRole('button', { name: /imprimir ticket/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No hay plantilla activa.');
  });

  it('"Cerrar" returns from the ticket view to the receipt', async () => {
    printMocks.thermal.mockRejectedValueOnce(new Error('Impresora desconectada'));
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {
              id: 1,
              sale_id: 1,
              template_id: 1,
              printable_width_mm: 48,
              margin_left_mm: 16,
              margin_right_mm: 16,
              font_family: 'COURIER_NEW',
              font_size_px: 9,
              line_height_px: 12,
              font_weight: 'NORMAL',
              margin_top_mm: 0,
              margin_bottom_mm: 0,
              rendered_text: 'Venta #1\n',
              created_at: '2026-08-08T10:00:00Z',
            },
            { status: 201 },
          ),
        ),
      ),
    );
    renderReceipt();
    await userEvent.click(screen.getByRole('button', { name: /imprimir ticket/i }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: /cerrar/i }));

    expect(screen.getByRole('button', { name: /imprimir ticket/i })).toBeInTheDocument();
  });
});
