import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { PosAuthProvider } from '@/features/auth/PosAuthProvider';

import { PosLoginPage } from './PosLoginPage';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PosAuthProvider>
          <PosLoginPage />
        </PosAuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PosLoginPage', () => {
  it('only presents administration-enabled POS users and logs in the selected one', async () => {
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/auth/pos/me')) return Promise.resolve(new Response(null, { status: 401 }));
      if (url.includes('/auth/pos/users')) {
        return Promise.resolve(
          jsonResponse([{ id: 7, full_name: 'María Caja', username: 'maria' }]),
        );
      }
      if (url.includes('/auth/pos/login')) {
        expect(JSON.parse(init?.body as string)).toEqual({ username: 'maria', pin: '1234' });
        return Promise.resolve(
          jsonResponse({
            id: 7,
            email: 'maria@example.com',
            full_name: 'María Caja',
            role: 'CASHIER',
            permissions: ['pos.access'],
            must_change_password: false,
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetch);
    renderPage();

    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'María Caja' });
    await user.selectOptions(await screen.findByLabelText('Usuario'), 'maria');
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: '4' }));
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/pos/login'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
