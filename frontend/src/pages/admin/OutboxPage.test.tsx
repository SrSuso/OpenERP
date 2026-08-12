import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type OutboxMessage } from '@/features/outbox/api';

import { OutboxPage } from './OutboxPage';

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
  permissions: ['admin.access', 'job.read', 'job.manage'],
};

function stubBackend() {
  const messages: OutboxMessage[] = [
    {
      id: 1,
      to_email: 'cliente@example.test',
      subject: 'Alerta: stock bajo',
      body_text: 'P000010 quedan 2 unidades.',
      status: 'PENDING',
      attempts: 0,
      last_error: null,
      sent_at: null,
      reference_type: 'incident',
      reference_id: 42,
      created_at: new Date().toISOString(),
    },
  ];
  let runCalls = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && /\/outbox\?/.test(url)) {
        const status = new URL(url, 'http://x').searchParams.get('status');
        return Promise.resolve(
          jsonResponse(status ? messages.filter((m) => m.status === status) : messages),
        );
      }
      if (method === 'POST' && /\/outbox\/run$/.test(url)) {
        runCalls += 1;
        messages[0]!.status = 'SENT';
        messages[0]!.sent_at = new Date().toISOString();
        return Promise.resolve(jsonResponse({ processed: 1 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { getRunCalls: () => runCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OutboxPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('OutboxPage', () => {
  it('lists outbox messages, expands one, and processes a batch', async () => {
    const backend = stubBackend();
    renderPage();

    await screen.findByText('cliente@example.test');
    expect(screen.getByText('Pendiente')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ver' }));
    await screen.findByText('P000010 quedan 2 unidades.');
    expect(screen.getByText(/Origen: incident #42/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Procesar ahora' }));

    await screen.findByText(/1 mensaje procesado/);
    expect(backend.getRunCalls()).toBe(1);
    expect(await screen.findByText('Enviado')).toBeInTheDocument();
  });
});
