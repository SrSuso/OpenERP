import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PosTerminalsPage } from './PosTerminalsPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function stubBackend() {
  let terminals = [
    {
      id: 7,
      name: 'Caja 1',
      warehouse_id: 1,
      warehouse_name: 'Tienda',
      is_active: true,
      created_at: '2026-08-11T09:00:00Z',
    },
  ];
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (method === 'GET' && url.includes('/pos-terminals')) {
        return Promise.resolve(jsonResponse(terminals));
      }
      if (method === 'GET' && url.includes('/warehouses')) {
        return Promise.resolve(jsonResponse([{ id: 1, name: 'Tienda', is_active: true }]));
      }
      if (method === 'POST' && /\/pos-terminals$/.test(url)) {
        writes.push(body);
        const created = {
          id: 8,
          name: body['name'],
          warehouse_id: body['warehouse_id'],
          warehouse_name: 'Tienda',
          is_active: true,
          created_at: '2026-08-11T10:00:00Z',
        };
        terminals = [...terminals, created as (typeof terminals)[number]];
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const patch = /\/pos-terminals\/(\d+)$/.exec(url);
      if (method === 'PATCH' && patch) {
        writes.push(body);
        const id = Number(patch[1]);
        terminals = terminals.map((terminal) =>
          terminal.id === id ? { ...terminal, ...body } : terminal,
        );
        return Promise.resolve(jsonResponse(terminals.find((terminal) => terminal.id === id)));
      }
      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url}`));
    }),
  );
  return { writes };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosTerminalsPage />
    </QueryClientProvider>,
  );
}

describe('PosTerminalsPage', () => {
  it('creates, renames and deactivates without offering warehouse reassignment or deletion', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByDisplayValue('Caja 1');

    await userEvent.type(screen.getByPlaceholderText('Caja 1'), 'Caja 2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir terminal' }));
    expect(await screen.findByDisplayValue('Caja 2')).toBeInTheDocument();
    expect(backend.writes).toContainEqual({ name: 'Caja 2', warehouse_id: 1 });

    const firstName = screen.getByLabelText('Nombre de Caja 1');
    await userEvent.clear(firstName);
    await userEvent.type(firstName, 'Caja principal');
    await userEvent.click(screen.getAllByRole('button', { name: 'Guardar nombre' })[0]!);
    await waitFor(() => expect(backend.writes).toContainEqual({ name: 'Caja principal' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Desactivar' })[0]!);
    await waitFor(() => expect(backend.writes).toContainEqual({ is_active: false }));

    expect(screen.queryByRole('button', { name: /eliminar/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cambiar almacén/i)).not.toBeInTheDocument();
  });
});
