import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type AuditLogEntry } from '@/features/audit/api';

import { AuditLogPage } from './AuditLogPage';

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
  permissions: ['admin.access', 'audit.read'],
};

const USERS = [
  {
    id: 1,
    email: 'admin@example.com',
    full_name: 'Admin Uno',
    is_active: true,
    role_id: 1,
    role_name: 'ADMIN',
  },
];

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    user_id: 1,
    action: 'updated',
    entity_type: 'product',
    entity_id: 7,
    before_data: { name: 'Antes' },
    after_data: { name: 'Después' },
    request_id: 'req-1',
    ip: '10.0.0.1',
    created_at: new Date('2026-08-10T10:00:00Z').toISOString(),
    ...overrides,
  };
}

function stubBackend(entries: AuditLogEntry[]) {
  const requestedUrls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (url.includes('/users')) return Promise.resolve(jsonResponse(USERS));
      if (url.includes('/audit-log')) {
        requestedUrls.push(url);
        return Promise.resolve(jsonResponse(entries));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${url} in test`));
    }),
  );

  return { requestedUrls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuditLogPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('AuditLogPage', () => {
  it('lists entries, resolves the user name, and expands the before/after detail', async () => {
    stubBackend([entry()]);
    renderPage();

    await screen.findByText('updated');
    expect(screen.getByRole('cell', { name: 'Admin Uno' })).toBeInTheDocument();
    expect(screen.getByText('product')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    expect(screen.getByText(/"name": "Antes"/)).toBeInTheDocument();
    expect(screen.getByText(/"name": "Después"/)).toBeInTheDocument();
  });

  it('shows "Sistema" for entries with no user (background jobs)', async () => {
    stubBackend([entry({ user_id: null, action: 'sent' })]);
    renderPage();

    await screen.findByText('Sistema');
  });

  it('does not reveal product SKUs in current or historical audit details', async () => {
    stubBackend([
      entry({
        before_data: { sku: 'AR000000008', name: 'Antes' },
        after_data: { product_sku: 'AR000000008', name: 'Después' },
      }),
    ]);
    renderPage();

    await screen.findByText('updated');
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(screen.getByText(/"name": "Antes"/)).toBeInTheDocument();
    expect(screen.getByText(/"name": "Después"/)).toBeInTheDocument();
    expect(screen.queryByText(/AR000000008/)).not.toBeInTheDocument();
  });

  it('sends the entity type filter to the backend and resets to page 1', async () => {
    const backend = stubBackend([entry()]);
    renderPage();

    await screen.findByText('updated');
    await userEvent.type(screen.getByLabelText('Tipo de entidad'), 'sale');

    await vi.waitFor(() => {
      const last = backend.requestedUrls.at(-1)!;
      expect(last).toContain('entity_type=sale');
      expect(last).toContain('offset=0');
    });
  });
});
