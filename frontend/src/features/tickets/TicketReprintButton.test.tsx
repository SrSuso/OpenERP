import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const printMocks = vi.hoisted(() => ({ thermal: vi.fn(() => Promise.resolve()) }));

vi.mock('./qzPrinter', () => ({ printThermalTicket: printMocks.thermal }));

import { TicketReprintButton } from './TicketReprintButton';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function ticketFor(saleId: number) {
  return {
    id: saleId,
    sale_id: saleId,
    template_id: 1,
    printable_width_mm: 80,
    margin_left_mm: 0,
    margin_right_mm: 0,
    font_family: 'COURIER_NEW',
    font_size_px: 10,
    line_height_px: 12,
    font_weight: 'NORMAL',
    margin_top_mm: 2,
    margin_bottom_mm: 2,
    rendered_text: `TICKET ${saleId}`,
    created_at: '2026-08-11T10:00:00Z',
  };
}

describe('TicketReprintButton', () => {
  it('sends each requested historical ticket once to QZ without accumulating documents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const saleId = Number(/\/sales\/(\d+)\/tickets$/.exec(url)?.[1]);
        return Promise.resolve(jsonResponse(ticketFor(saleId)));
      }),
    );
    printMocks.thermal.mockClear();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TicketReprintButton saleId={101} label="Ticket 101" />
        <TicketReprintButton saleId={102} label="Ticket 102" />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ticket 101' }));
    await waitFor(() =>
      expect(printMocks.thermal).toHaveBeenCalledWith(
        'TICKET 101',
        expect.objectContaining({ sale_id: 101 }),
        expect.any(Object),
      ),
    );
    expect(screen.getByRole('button', { name: 'Ticket 101' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ticket 102' }));
    await waitFor(() => expect(printMocks.thermal).toHaveBeenCalledTimes(2));
    expect(printMocks.thermal).toHaveBeenLastCalledWith(
      'TICKET 102',
      expect.objectContaining({ sale_id: 102 }),
      expect.any(Object),
    );
    expect(document.querySelectorAll('[data-ticket-paper-preview]')).toHaveLength(0);
  });
});
