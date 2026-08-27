import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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
  it('never leaves a cancelled reprint in the next print document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const saleId = Number(/\/sales\/(\d+)\/tickets$/.exec(url)?.[1]);
        return Promise.resolve(jsonResponse(ticketFor(saleId)));
      }),
    );
    const activeDocumentCounts: number[] = [];
    vi.stubGlobal('print', () => {
      activeDocumentCounts.push(
        document.querySelectorAll(".ticket-print-root[data-print-active='true']").length,
      );
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TicketReprintButton saleId={101} label="Ticket 101" />
        <TicketReprintButton saleId={102} label="Ticket 102" />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ticket 101' }));
    await waitFor(() => expect(activeDocumentCounts).toEqual([1]));
    expect(document.querySelector('style')?.textContent).toContain('@page { size: 80mm');

    // El evento se dispara tanto al imprimir como al cancelar el diálogo.
    // Por eso el documento anterior deja de existir antes del siguiente.
    await act(() => window.dispatchEvent(new Event('afterprint')));
    await waitFor(() =>
      expect(
        document.querySelectorAll(".ticket-print-root[data-print-active='true']"),
      ).toHaveLength(0),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ticket 102' }));
    await waitFor(() => expect(activeDocumentCounts).toEqual([1, 1]));
  });
});
