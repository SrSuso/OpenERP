import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const printMocks = vi.hoisted(() => ({
  thermal: vi.fn(() => Promise.resolve()),
  drawer: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/features/tickets/qzPrinter', () => ({
  printThermalTicket: printMocks.thermal,
  openCashDrawer: printMocks.drawer,
}));

import { ZReportReprintButton } from './ZReportReprintButton';

const PRINT_PROFILE = {
  printable_width_mm: 72,
  margin_left_mm: 1,
  margin_right_mm: 1,
  font_family: 'LIBERATION_MONO',
  font_size_px: 10,
  line_height_px: 13,
  font_weight: 'NORMAL',
  margin_top_mm: 2,
  margin_bottom_mm: 2,
};

const REPORT = {
  id: 10,
  warehouse_id: 2,
  warehouse_name: 'Tienda principal',
  number: 7,
  business_date: '2026-08-28',
  covers_from: null,
  closed_at: '2026-08-28T18:00:00Z',
  is_final: true,
  finalized_at: '2026-08-28T18:00:00Z',
  store_name: 'Comercial Barbosa',
  store_tax_id: 'B12345678',
  store_address: 'Calle Mayor 1',
  closed_by_name: 'Ana',
  sales_count: 3,
  gross_total: '41.800000',
  tax_total: '3.800000',
  discount_total: '0.000000',
  cash_total: '25.000000',
  card_total: '16.800000',
  other_total: '0.000000',
  returns_count: 1,
  returns_total: '2.000000',
  first_sale_number: 31,
  last_sale_number: 33,
  tax_breakdown: [
    { rate: '10.000000', taxable_base: '38.000000', tax_amount: '3.800000', total: '41.800000' },
  ],
  payment_breakdown: [
    {
      method: 'CASH',
      collected_total: '25.000000',
      refunded_total: '2.000000',
      net_total: '23.000000',
    },
    {
      method: 'CARD',
      collected_total: '16.800000',
      refunded_total: '0.000000',
      net_total: '16.800000',
    },
    {
      method: 'OTHER',
      collected_total: '0.000000',
      refunded_total: '0.000000',
      net_total: '0.000000',
    },
  ],
  terminal_breakdown: [
    { terminal_id: 7, terminal_name: 'Caja 1', sales_count: 3, gross_total: '41.800000' },
  ],
  cashier_breakdown: [
    { cashier_user_id: 1, cashier_name: 'Ana', sales_count: 3, gross_total: '41.800000' },
  ],
  closed_by_user_id: 1,
};

describe('ZReportReprintButton', () => {
  it('prints the persisted Z totals with the active thermal print profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(PRINT_PROFILE), {
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    printMocks.thermal.mockClear();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ZReportReprintButton report={REPORT} closedAtLabel="28/08/2026 20:00" />
      </QueryClientProvider>,
    );

    const button = await screen.findByRole('button', { name: 'Reimprimir Z nº 7' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await waitFor(() => expect(printMocks.thermal).toHaveBeenCalledTimes(1));
    expect(printMocks.thermal).toHaveBeenCalledWith(
      expect.stringMatching(/CIERRE Z DEFINITIVO Nº 7[\s\S]*VENTAS BRUTAS/),
      expect.objectContaining({ printable_width_mm: 72 }),
      expect.any(Object),
    );
    await waitFor(() => expect(printMocks.drawer).toHaveBeenCalledTimes(1));
  });
});
