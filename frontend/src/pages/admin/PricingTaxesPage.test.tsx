import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
  const taxes: Tax[] = [{ id: 1, name: 'IVA general', rate: '21', is_active: true }];
  const createCalls: { name: string; rate: string }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/taxes')) return Promise.resolve(jsonResponse(taxes));
      if (method === 'POST' && url.includes('/taxes')) {
        const body = init?.body
          ? (JSON.parse(init.body as string) as { name: string; rate: string })
          : { name: '', rate: '' };
        createCalls.push(body);
        const created: Tax = { id: 2, name: body.name, rate: body.rate, is_active: true };
        taxes.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls };
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
    expect(backend.createCalls).toEqual([{ name: 'Recargo de equivalencia', rate: '5.2' }]);
  });
});
