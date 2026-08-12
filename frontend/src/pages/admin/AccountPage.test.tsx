import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Session } from '@/features/auth/api';

import { AccountPage } from './AccountPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const ME = {
  id: 1,
  email: 'cajero@example.com',
  full_name: 'Cajero Uno',
  role: 'CASHIER',
  permissions: ['admin.access'],
};

function stubBackend() {
  let sessions: Session[] = [
    {
      id: 1,
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      expires_at: new Date().toISOString(),
      user_agent: 'Chrome en Windows',
      ip: '10.0.0.1',
      is_current: true,
    },
    {
      id: 2,
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      expires_at: new Date().toISOString(),
      user_agent: 'Chrome en el TPV de caja 2',
      ip: '10.0.0.2',
      is_current: false,
    },
  ];
  const revokeCalls: number[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/auth/sessions')) {
        return Promise.resolve(jsonResponse(sessions));
      }
      const revokeMatch = /\/auth\/sessions\/(\d+)$/.exec(url);
      if (method === 'DELETE' && revokeMatch) {
        const id = Number(revokeMatch[1]);
        revokeCalls.push(id);
        sessions = sessions.filter((s) => s.id !== id);
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { revokeCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AccountPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('AccountPage', () => {
  it('lists active sessions, marks the current one, and closes another one', async () => {
    const backend = stubBackend();
    renderPage();

    await screen.findByText('Chrome en Windows');
    expect(screen.getByText('Esta sesión')).toBeInTheDocument();
    await screen.findByText('Chrome en el TPV de caja 2');

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    await vi.waitFor(() => expect(backend.revokeCalls).toEqual([2]));
    expect(screen.queryByText('Chrome en el TPV de caja 2')).not.toBeInTheDocument();
  });
});
