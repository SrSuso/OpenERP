import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type ReportDefinition, type ReportSubjectInfo } from '@/features/reports/api';

import { ReportsPage } from './ReportsPage';

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
  permissions: ['admin.access', 'report.read', 'report.manage'],
};

const SUBJECTS: ReportSubjectInfo[] = [
  {
    subject: 'SALES',
    label: 'Ventas',
    dimensions: [
      { key: 'date', label: 'Fecha' },
      { key: 'product', label: 'Producto' },
    ],
    metrics: [
      { key: 'quantity', label: 'Cantidad' },
      { key: 'revenue', label: 'Ingresos' },
    ],
    filter_keys: [
      'warehouse_id',
      'category_id',
      'product_id',
      'cashier_user_id',
      'date_from',
      'date_to',
    ],
  },
];

function stubBackend() {
  let definitions: ReportDefinition[] = [];
  const runCalls: Record<string, unknown>[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const updateCalls: Record<string, unknown>[] = [];
  const deleteCalls: number[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/report-subjects')) {
        return Promise.resolve(jsonResponse(SUBJECTS));
      }
      if (method === 'GET' && url.includes('/warehouses')) return Promise.resolve(jsonResponse([]));
      if (method === 'GET' && url.includes('/product-categories'))
        return Promise.resolve(jsonResponse([]));
      if (method === 'GET' && url.includes('/products?')) return Promise.resolve(jsonResponse([]));
      if (method === 'GET' && url.includes('/suppliers?')) return Promise.resolve(jsonResponse([]));
      if (method === 'GET' && url.includes('/users')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 2,
              email: 'caja@example.com',
              full_name: 'Cajera Uno',
              is_active: true,
              must_change_password: false,
              role_id: 2,
              role_name: 'Cajera',
              pos_username: 'cajera',
              pos_pin_configured: true,
              pos_access_enabled: true,
            },
          ]),
        );
      }
      if (method === 'GET' && url.includes('/report-definitions')) {
        return Promise.resolve(jsonResponse(definitions));
      }
      if (method === 'POST' && url.includes('/reports/run')) {
        const b = body();
        runCalls.push(b);
        return Promise.resolve(
          jsonResponse({
            columns: ['product_name', 'quantity'],
            rows: [{ product_name: 'Agua 1.5L', quantity: '12.000000' }],
          }),
        );
      }
      const updateMatch = /\/report-definitions\/(\d+)$/.exec(url);
      if (method === 'PUT' && updateMatch) {
        const b = body();
        updateCalls.push(b);
        const updated: ReportDefinition = {
          id: Number(updateMatch[1]),
          name: b['name'] as string,
          subject: b['subject'] as ReportDefinition['subject'],
          dimensions: b['dimensions'] as string[],
          metrics: b['metrics'] as string[],
          filters: b['filters'] as Record<string, unknown>,
          created_at: definitions[0]?.created_at ?? new Date().toISOString(),
        };
        definitions = [updated];
        return Promise.resolve(jsonResponse(updated));
      }
      const runDefMatch = /\/report-definitions\/(\d+)\/run$/.exec(url);
      if (method === 'POST' && runDefMatch) {
        return Promise.resolve(
          jsonResponse({
            columns: ['product_name', 'quantity'],
            rows: [{ product_name: 'Agua 1.5L', quantity: '12.000000' }],
          }),
        );
      }
      if (method === 'POST' && url.includes('/report-definitions')) {
        const b = body();
        createCalls.push(b);
        const created: ReportDefinition = {
          id: 1,
          name: b['name'] as string,
          subject: b['subject'] as ReportDefinition['subject'],
          dimensions: b['dimensions'] as string[],
          metrics: b['metrics'] as string[],
          filters: b['filters'] as Record<string, unknown>,
          created_at: new Date().toISOString(),
        };
        definitions = [created];
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const deleteMatch = /\/report-definitions\/(\d+)$/.exec(url);
      if (method === 'DELETE' && deleteMatch) {
        deleteCalls.push(Number(deleteMatch[1]));
        definitions = [];
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { runCalls, createCalls, updateCalls, deleteCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ReportsPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ReportsPage', () => {
  it('builds a report (subject, dimension, metric, filter), runs it, saves it, runs it again and deletes it', async () => {
    const backend = stubBackend();
    renderPage();

    await screen.findByText('Todavía no has guardado ningún informe.');

    await userEvent.selectOptions(screen.getByLabelText('Qué quieres consultar'), 'SALES');
    await userEvent.click(screen.getByRole('button', { name: 'Producto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cantidad' }));
    await userEvent.selectOptions(screen.getByLabelText('Cajero'), '2');

    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar informe' }));

    expect(await screen.findByText('Agua 1.5L')).toBeInTheDocument();
    expect(screen.queryByText('P000010')).not.toBeInTheDocument();
    expect(backend.runCalls).toEqual([
      {
        subject: 'SALES',
        dimensions: ['product'],
        metrics: ['quantity'],
        filters: { cashier_user_id: 2 },
      },
    ]);

    await userEvent.type(screen.getByLabelText('Guardar como'), 'Ventas por producto');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar informe' }));

    expect(await screen.findByText('Ventas por producto')).toBeInTheDocument();
    expect(backend.createCalls).toEqual([
      {
        name: 'Ventas por producto',
        subject: 'SALES',
        dimensions: ['product'],
        metrics: ['quantity'],
        filters: { cashier_user_id: 2 },
      },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByLabelText('Qué quieres consultar')).toHaveValue('SALES');
    expect(screen.getByLabelText('Guardar como')).toHaveValue('Ventas por producto');
    await userEvent.clear(screen.getByLabelText('Guardar como'));
    await userEvent.type(screen.getByLabelText('Guardar como'), 'Ventas de caja');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Ventas de caja')).toBeInTheDocument();
    expect(backend.updateCalls).toMatchObject([
      {
        name: 'Ventas de caja',
        subject: 'SALES',
        dimensions: ['product'],
        metrics: ['quantity'],
        filters: { cashier_user_id: 2 },
      },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await screen.findByText('Todavía no has guardado ningún informe.');
    expect(backend.deleteCalls).toEqual([1]);
  });
});
