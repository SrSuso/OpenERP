import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type Permission, type Role } from '@/features/roles/api';

import { RolesPage } from './RolesPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const PERMISSIONS: Permission[] = [
  { id: 1, key: 'admin.access', description: 'Enter the administration panel.' },
  { id: 2, key: 'pos.access', description: 'Enter the point of sale.' },
  { id: 3, key: 'users.manage', description: 'Create, edit and deactivate user accounts.' },
];

function baseRoles(): Role[] {
  return [
    {
      id: 1,
      name: 'ADMIN',
      description: 'Full access.',
      permissions: ['admin.access', 'pos.access', 'users.manage'],
    },
    { id: 3, name: 'CASHIER', description: '', permissions: ['pos.access'] },
  ];
}

function stubBackend(options: { roles?: Role[] } = {}) {
  const roles: Role[] = options.roles ?? baseRoles();
  const createCalls: { name: string; description: string }[] = [];
  const patchCalls: { roleId: number; keys: string[] }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (method === 'GET' && /\/permissions$/.test(url)) {
        return Promise.resolve(jsonResponse(PERMISSIONS));
      }
      if (method === 'GET' && /\/roles$/.test(url)) {
        return Promise.resolve(jsonResponse(roles));
      }
      if (method === 'POST' && /\/roles$/.test(url)) {
        const body = init?.body
          ? (JSON.parse(init.body as string) as { name: string; description: string })
          : { name: '', description: '' };
        createCalls.push(body);
        if (roles.some((r) => r.name === body.name)) {
          return Promise.resolve(
            jsonResponse(
              { error: { code: 'conflict', message: 'A role with this name already exists.' } },
              { status: 409 },
            ),
          );
        }
        const created: Role = {
          id: 99,
          name: body.name,
          description: body.description,
          permissions: [],
        };
        roles.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'PATCH' && /\/roles\/(\d+)\/permissions$/.test(url)) {
        const roleId = Number(/\/roles\/(\d+)\/permissions$/.exec(url)![1]);
        const body = init?.body
          ? (JSON.parse(init.body as string) as { permission_keys: string[] })
          : { permission_keys: [] };
        patchCalls.push({ roleId, keys: body.permission_keys });
        const role = roles.find((r) => r.id === roleId)!;
        role.permissions = body.permission_keys;
        return Promise.resolve(jsonResponse(role));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls, patchCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RolesPage />
    </QueryClientProvider>,
  );
}

/** RoleCard shows the *full* permission catalogue for every role (checked
 * state differs), so "admin.access" as a label exists once per role card —
 * every assertion below has to scope to one card via `within`. */
function cardFor(roleName: string): HTMLElement {
  return screen.getByText(roleName).closest('div.rounded-lg')!;
}

describe('RolesPage', () => {
  it('lists roles with their current permissions checked', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('CASHIER');

    const admin = within(cardFor('ADMIN'));
    expect(admin.getByLabelText('admin.access')).toBeChecked();
    expect(admin.getByLabelText('users.manage')).toBeChecked();

    const cashier = within(cardFor('CASHIER'));
    expect(cashier.getByLabelText('pos.access')).toBeChecked();
    expect(cashier.getByLabelText('admin.access')).not.toBeChecked();
  });

  it('does not show "Guardar cambios" until a permission is toggled', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('CASHIER');

    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });

  it('saving a toggled permission calls the API with the full new set', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('CASHIER');

    const admin = within(cardFor('ADMIN'));
    await userEvent.click(admin.getByLabelText('users.manage'));
    await userEvent.click(admin.getByRole('button', { name: 'Guardar cambios' }));

    expect(backend.patchCalls).toEqual([{ roleId: 1, keys: ['admin.access', 'pos.access'] }]);
  });

  it('creates a new role', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('CASHIER');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo rol' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'AUDITOR');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('AUDITOR')).toBeInTheDocument();
    expect(backend.createCalls).toEqual([{ name: 'AUDITOR', description: '' }]);
  });

  it('shows a clear error when the role name is already taken', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('CASHIER');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo rol' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'ADMIN');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Ya existe un rol con ese nombre.')).toBeInTheDocument();
  });
});
