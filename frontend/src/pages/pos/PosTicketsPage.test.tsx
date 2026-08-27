import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Sale } from '@/features/pos/api';
import { POS_TERMINAL_STORAGE_KEY, PosTerminalProvider } from '@/features/pos/PosTerminalProvider';

import { PosTicketsPage } from './PosTicketsPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const TERMINAL = {
  id: 7,
  name: 'Caja 1',
  warehouse_id: 1,
  warehouse_name: 'Tienda',
  is_active: true,
  created_at: '2026-08-11T09:00:00Z',
};

const COMPLETED_SALE: Sale = {
  id: 42,
  number: 1042,
  warehouse_id: 1,
  location_id: 1,
  terminal_id: 7,
  terminal_name: 'Caja 1',
  status: 'COMPLETED',
  notes: '',
  cashier_name: 'Ana',
  completed_at: '2026-08-11T10:15:00Z',
  created_at: '2026-08-11T10:00:00Z',
  lines: [],
  total: '12.500000',
  payments: [],
  change_due: '0.000000',
};

function stubBackend() {
  const saleQueries: string[] = [];
  const ticketCalls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (url.includes('/pos-terminals')) return Promise.resolve(jsonResponse([TERMINAL]));
      if (url.includes('/settings/values')) {
        return Promise.resolve(jsonResponse({ 'business.timezone': 'Europe/Madrid' }));
      }
      if (method === 'GET' && /\/sales\?/.test(url)) {
        saleQueries.push(url);
        return Promise.resolve(jsonResponse([COMPLETED_SALE]));
      }
      if (method === 'POST' && /\/sales\/42\/tickets$/.test(url)) {
        ticketCalls.push(url);
        return Promise.resolve(
          jsonResponse({
            id: 8,
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
            rendered_text: 'TICKET 1042',
            created_at: '2026-08-11T10:15:00Z',
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url}`));
    }),
  );
  return { saleQueries, ticketCalls };
}

function renderPage() {
  window.localStorage.setItem(POS_TERMINAL_STORAGE_KEY, '7');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosTerminalProvider>
        <MemoryRouter initialEntries={['/pos/tickets']}>
          <Routes>
            <Route path="/pos/tickets" element={<PosTicketsPage />} />
            <Route path="/pos" element={<p>TPV</p>} />
          </Routes>
        </MemoryRouter>
      </PosTerminalProvider>
    </QueryClientProvider>,
  );
}

describe('PosTicketsPage', () => {
  beforeEach(() => window.localStorage.clear());

  it('lists and reprints completed tickets from only the selected terminal', async () => {
    const backend = stubBackend();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Tickets anteriores' })).toBeInTheDocument();
    expect(await screen.findByText('#1042')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    await waitFor(() => expect(backend.saleQueries).toHaveLength(1));
    const query = new URL(backend.saleQueries[0]!, 'http://test').searchParams;
    expect(query.get('status')).toBe('COMPLETED');
    expect(query.get('terminal_id')).toBe('7');

    await userEvent.click(screen.getByRole('button', { name: 'Reimprimir ticket' }));
    await waitFor(() => expect(backend.ticketCalls).toEqual(['/api/v1/sales/42/tickets']));
    expect(await screen.findByText('TICKET 1042')).toBeInTheDocument();
    expect(print).toHaveBeenCalledTimes(1);
  });
});
