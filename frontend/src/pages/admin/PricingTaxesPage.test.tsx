import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type Tax } from '@/features/pricing/api';

import { PricingTaxesPage } from './PricingTaxesPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const ME = {
  id: 1,
  email: 'admin@example.com',
  full_name: 'Admin Uno',
  role: 'ADMIN',
  permissions: ['admin.access', 'pricing.manage'],
};

function stubBackend() {
  const taxes: Tax[] = [
    { id: 1, name: 'IVA general', rate: '21', surcharge_rate: '0', is_active: true },
  ];
  const createCalls: { name: string; rate: string; surcharge_rate: string }[] = [];
  const updateCalls: { id: number; body: Record<string, unknown> }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/taxes')) return Promise.resolve(jsonResponse(taxes));
      if (method === 'POST' && /\/taxes$/.test(url)) {
        const body = init?.body
          ? (JSON.parse(init.body as string) as {
              name: string;
              rate: string;
              surcharge_rate: string;
            })
          : { name: '', rate: '', surcharge_rate: '0' };
        createCalls.push(body);
        const created: Tax = {
          id: 2,
          name: body.name,
          rate: body.rate,
          surcharge_rate: body.surcharge_rate,
          is_active: true,
        };
        taxes.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const activeMatch = /\/taxes\/(\d+)\/(deactivate|activate)$/.exec(url);
      if (method === 'POST' && activeMatch) {
        const target = taxes.find((t) => t.id === Number(activeMatch[1]))!;
        target.is_active = activeMatch[2] === 'activate';
        return Promise.resolve(jsonResponse(target));
      }
      if (method === 'PATCH' && /\/taxes\/(\d+)$/.test(url)) {
        const id = Number(/\/taxes\/(\d+)$/.exec(url)![1]);
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        updateCalls.push({ id, body });
        const tax = taxes.find((t) => t.id === id)!;
        if ('name' in body) tax.name = body['name'] as string;
        if ('rate' in body) tax.rate = body['rate'] as string;
        return Promise.resolve(jsonResponse(tax));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls, updateCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PricingTaxesPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('PricingTaxesPage', () => {
  it('lists existing taxes', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByText('IVA general')).toBeInTheDocument();
    expect(screen.getByText('21%')).toBeInTheDocument();
  });

  it('creates a tax with a name and a rate', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('IVA general');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Recargo de equivalencia');
    await userEvent.type(screen.getByLabelText('Tasa (%)'), '5.2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir' }));

    expect(await screen.findByText('Recargo de equivalencia')).toBeInTheDocument();
    expect(backend.createCalls).toEqual([
      { name: 'Recargo de equivalencia', rate: '5.2', surcharge_rate: '0' },
    ]);
  });

  it('creates an IVA carrying its recargo de equivalencia', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('IVA general');

    await userEvent.type(screen.getByLabelText('Nombre'), 'IVA 21');
    await userEvent.type(screen.getByLabelText('Tasa (%)'), '21');
    await userEvent.type(screen.getByLabelText('Recargo eq. (%)'), '5.2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir' }));

    await screen.findByText('IVA 21');
    expect(backend.createCalls).toEqual([{ name: 'IVA 21', rate: '21', surcharge_rate: '5.2' }]);
    // La fila lo muestra junto a la tasa, para no tener que abrir la edición.
    expect(screen.getByText(/\+ RE 5,2%/)).toBeInTheDocument();
  });

  it('edits a tax name and rate inline', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('IVA general');

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const nameInput = screen.getAllByDisplayValue('IVA general')[0]!;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'IVA reducido');
    const rateInput = screen.getAllByDisplayValue('21')[0]!;
    await userEvent.clear(rateInput);
    await userEvent.type(rateInput, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('IVA reducido')).toBeInTheDocument();
    expect(backend.updateCalls).toEqual([
      { id: 1, body: { name: 'IVA reducido', rate: '10', surcharge_rate: '0' } },
    ]);
  });

  it('cancels an edit without saving', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('IVA general');

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByText('IVA general')).toBeInTheDocument();
    expect(backend.updateCalls).toEqual([]);
  });

  it('deactivates a tax instead of deleting it, and can bring it back', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('IVA general');

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    // Sigue en la lista — lo que ya se vendió con él tiene que seguir
    // siendo legible — pero marcado como retirado.
    expect(await screen.findByText('(desactivado)')).toBeInTheDocument();
    expect(screen.getByText('IVA general')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reactivar' }));

    await waitFor(() => expect(screen.queryByText('(desactivado)')).not.toBeInTheDocument());
  });
});
