import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Receipt } from './Receipt';
import { type Sale } from './api';

const PAID_SALE: Sale = {
  id: 1,
  warehouse_id: 1,
  location_id: 1,
  status: 'COMPLETED',
  notes: '',
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

describe('Receipt', () => {
  let printMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    printMock = vi.fn();
    vi.stubGlobal('print', printMock);
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

  it('generates and shows the ticket text, then triggers window.print()', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {
              id: 1,
              sale_id: 1,
              template_id: 1,
              width_mm: 58,
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

    expect(await screen.findByText(/TOTAL 20\.00/)).toBeInTheDocument();
    expect(printMock).toHaveBeenCalled();
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
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {
              id: 1,
              sale_id: 1,
              template_id: 1,
              width_mm: 58,
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
    await screen.findByText(/Venta #1/);

    await userEvent.click(screen.getByRole('button', { name: /cerrar/i }));

    expect(screen.getByRole('button', { name: /imprimir ticket/i })).toBeInTheDocument();
  });
});
