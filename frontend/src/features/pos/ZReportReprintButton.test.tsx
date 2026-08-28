import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const printMocks = vi.hoisted(() => ({ thermal: vi.fn(() => Promise.resolve()) }));

vi.mock('@/features/tickets/qzPrinter', () => ({ printThermalTicket: printMocks.thermal }));

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
  number: 7,
  covers_from: null,
  closed_at: '2026-08-28T18:00:00Z',
  sales_count: 3,
  gross_total: '41.800000',
  tax_total: '3.800000',
  discount_total: '0.000000',
  cash_total: '25.000000',
  card_total: '16.800000',
  other_total: '0.000000',
  returns_count: 1,
  returns_total: '2.000000',
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
      expect.stringMatching(/CIERRE Z Nº 7[\s\S]*TOTAL COBRADO/),
      expect.objectContaining({ printable_width_mm: 72 }),
      expect.any(Object),
    );
  });
});
