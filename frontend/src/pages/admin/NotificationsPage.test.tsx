import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { type Warehouse } from '@/features/inventory/api';
import { type Incident, type NotificationRule } from '@/features/notifications/api';

import { NotificationsPage } from './NotificationsPage';

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
  permissions: ['admin.access', 'notification.read', 'notification.manage'],
};

function stubBackend() {
  const warehouse: Warehouse = { id: 1, name: 'Almacén central', is_active: true };
  const rules: NotificationRule[] = [];
  let incidents: Incident[] = [];
  const createRuleCalls: Record<string, unknown>[] = [];
  const toggleCalls: { id: number; body: Record<string, unknown> }[] = [];
  const deletedRuleIds: number[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/notification-fields')) {
        return Promise.resolve(
          jsonResponse({
            subjects: [
              {
                key: 'PRODUCT',
                label: 'Productos',
                fields: [
                  { key: 'stock', label: 'Stock actual', type: 'NUMBER', help: 'Unidades.' },
                ],
              },
            ],
            operators: ['=', '!=', '<', '<=', '>', '>='],
            severities: ['LOW', 'MEDIUM_LOW', 'MEDIUM_HIGH', 'HIGH'],
          }),
        );
      }
      if (method === 'GET' && /\/warehouses$/.test(url))
        return Promise.resolve(jsonResponse([warehouse]));

      if (method === 'GET' && /\/notification-rules$/.test(url)) {
        return Promise.resolve(jsonResponse(rules));
      }
      if (method === 'POST' && /\/notification-rules$/.test(url)) {
        const b = body();
        createRuleCalls.push(b);
        const created: NotificationRule = {
          id: rules.length + 1,
          name: b['name'] as string,
          rule_type: b['rule_type'] as NotificationRule['rule_type'],
          severity: b['severity'] as NotificationRule['severity'],
          params: b['params'] as Record<string, unknown>,
          is_active: true,
        };
        rules.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const toggleMatch = /\/notification-rules\/(\d+)$/.exec(url);
      if (method === 'DELETE' && toggleMatch) {
        const id = Number(toggleMatch[1]);
        deletedRuleIds.push(id);
        const index = rules.findIndex((rule) => rule.id === id);
        if (index >= 0) rules.splice(index, 1);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (method === 'PATCH' && toggleMatch) {
        const id = Number(toggleMatch[1]);
        const b = body();
        toggleCalls.push({ id, body: b });
        const rule = rules.find((r) => r.id === id)!;
        if ('is_active' in b) rule.is_active = b['is_active'] as boolean;
        if ('name' in b) rule.name = b['name'] as string;
        if ('params' in b) rule.params = b['params'] as Record<string, unknown>;
        if ('severity' in b) rule.severity = b['severity'] as NotificationRule['severity'];
        return Promise.resolve(jsonResponse(rule));
      }

      if (method === 'GET' && /\/incidents\?/.test(url)) {
        const status = new URL(url, 'http://x').searchParams.get('status');
        return Promise.resolve(
          jsonResponse(status ? incidents.filter((i) => i.status === status) : incidents),
        );
      }
      if (method === 'POST' && /\/notifications\/evaluate$/.test(url)) {
        incidents = [
          {
            id: 1,
            rule_id: 1,
            rule_name: rules[0]?.name ?? 'Stock bajo',
            severity: 'HIGH' as const,
            subject_type: 'product',
            subject_id: 10,
            message: 'P000010 (Agua): quedan 2 unidades, por debajo del mínimo (5).',
            status: 'OPEN',
            first_detected_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            resolved_at: null,
          },
        ];
        return Promise.resolve(jsonResponse(incidents));
      }
      const resolveMatch = /\/incidents\/(\d+)\/resolve$/.exec(url);
      if (method === 'POST' && resolveMatch) {
        const incident = incidents.find((i) => i.id === Number(resolveMatch[1]))!;
        incident.status = 'RESOLVED';
        incident.resolved_at = new Date().toISOString();
        return Promise.resolve(jsonResponse(incident));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createRuleCalls, toggleCalls, deletedRuleIds };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NotificationsPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('NotificationsPage', () => {
  it('creates a low-stock rule, deactivates it, then evaluates and resolves an incident', async () => {
    const backend = stubBackend();
    renderPage();

    // La prioridad operativa es atender primero lo que ya está ocurriendo.
    expect(await screen.findByText('No hay incidencias con estos filtros.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reglas' }));
    await screen.findByText('Todavía no hay ninguna regla.');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }));

    await userEvent.type(screen.getByLabelText('Nombre'), 'Stock bajo almacén central');
    await userEvent.selectOptions(screen.getByLabelText('Almacén (vacío = todos)'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await screen.findByText('Stock bajo almacén central');
    expect(backend.createRuleCalls).toEqual([
      {
        name: 'Stock bajo almacén central',
        rule_type: 'LOW_STOCK',
        severity: 'MEDIUM_LOW',
        params: { warehouse_id: 1 },
      },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await screen.findByText('Inactiva');
    expect(backend.toggleCalls).toEqual([{ id: 1, body: { is_active: false } }]);

    await userEvent.click(screen.getByRole('button', { name: 'Incidencias' }));
    await screen.findByText('No hay incidencias con estos filtros.');

    await userEvent.click(screen.getByRole('button', { name: 'Evaluar ahora' }));
    await screen.findByText(/quedan 2 unidades/);

    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    await screen.findByText('No hay incidencias con estos filtros.');
  });

  it('builds a rule from the fields and comparators the backend offers', async () => {
    const backend = stubBackend();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Reglas' }));
    await screen.findByRole('button', { name: 'Nueva regla' });
    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }));

    await userEvent.type(screen.getByLabelText('Nombre'), 'Stock por debajo de 5');
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'CONDITION');
    await userEvent.selectOptions(screen.getByLabelText('Criticidad'), 'HIGH');
    await userEvent.selectOptions(screen.getByLabelText('Avisar sobre'), 'PRODUCT');

    await userEvent.click(screen.getByRole('button', { name: 'Añadir condición' }));
    // Los campos y comparadores vienen del backend, no escritos en el panel.
    await userEvent.selectOptions(screen.getByLabelText('Campo 1'), 'stock');
    await userEvent.selectOptions(screen.getByLabelText('Comparador 1'), '<');
    await userEvent.type(screen.getByLabelText('Valor 1'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() =>
      expect(backend.createRuleCalls).toEqual([
        {
          name: 'Stock por debajo de 5',
          rule_type: 'CONDITION',
          severity: 'HIGH',
          params: {
            subject: 'PRODUCT',
            conditions: [{ field: 'stock', operator: '<', value: 5 }],
          },
        },
      ]),
    );
  });

  it('edits a rule through the existing PATCH endpoint without changing its type', async () => {
    const backend = stubBackend();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Reglas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Stock almacén');
    await userEvent.selectOptions(screen.getByLabelText('Almacén (vacío = todos)'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await screen.findByText('Stock almacén');

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByLabelText('Tipo')).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Nombre'));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Stock urgente');
    await userEvent.selectOptions(screen.getByLabelText('Criticidad'), 'HIGH');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await screen.findByText('Stock urgente');
    expect(backend.toggleCalls).toEqual([
      {
        id: 1,
        body: {
          name: 'Stock urgente',
          severity: 'HIGH',
          params: { warehouse_id: 1 },
        },
      },
    ]);
  });

  it('confirms and deletes a rule', async () => {
    const backend = stubBackend();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Reglas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'Regla equivocada');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await screen.findByText('Regla equivocada');

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(backend.deletedRuleIds).toEqual([1]));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('incidencias generadas'));
    expect(await screen.findByText('Todavía no hay ninguna regla.')).toBeInTheDocument();
    confirm.mockRestore();
  });
});
