import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type Role } from '@/features/roles/api';
import { type User } from '@/features/users/api';

import { UsersPage } from './UsersPage';

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
  permissions: ['admin.access', 'users.manage', 'roles.manage'],
};

const ROLES: Role[] = [
  { id: 1, name: 'ADMIN', description: '', permissions: [] },
  { id: 3, name: 'CASHIER', description: '', permissions: [] },
];

function baseUsers(): User[] {
  return [
    {
      id: 1,
      email: 'admin@example.com',
      full_name: 'Admin Uno',
      is_active: true,
      role_id: 1,
      role_name: 'ADMIN',
    },
    {
      id: 2,
      email: 'cajero@example.com',
      full_name: 'Cajero Dos',
      is_active: true,
      role_id: 3,
      role_name: 'CASHIER',
    },
  ];
}

/** Same style as pages/admin/AdminHomePage.test.tsx's stubBackend. */
function stubBackend(options: { users?: User[] } = {}) {
  const users: User[] = options.users ?? baseUsers();
  const createCalls: unknown[] = [];
  const patchCalls: { userId: number; roleId: number }[] = [];
  const deactivateCalls: number[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) {
        return Promise.resolve(jsonResponse(ME));
      }
      if (method === 'GET' && /\/roles$/.test(url)) {
        return Promise.resolve(jsonResponse(ROLES));
      }
      if (method === 'GET' && /\/users$/.test(url)) {
        return Promise.resolve(jsonResponse(users));
      }
      if (method === 'POST' && /\/users$/.test(url)) {
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        createCalls.push(body);
        if (users.some((u) => u.email === body['email'])) {
          return Promise.resolve(
            jsonResponse(
              { error: { code: 'conflict', message: 'A user with this email already exists.' } },
              { status: 409 },
            ),
          );
        }
        const created: User = {
          id: 99,
          email: body['email'] as string,
          full_name: body['full_name'] as string,
          is_active: true,
          role_id: body['role_id'] as number,
          role_name: 'CASHIER',
        };
        users.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (method === 'PATCH' && /\/users\/(\d+)$/.test(url)) {
        const userId = Number(/\/users\/(\d+)$/.exec(url)![1]);
        const body = init?.body
          ? (JSON.parse(init.body as string) as { role_id: number })
          : { role_id: 0 };
        patchCalls.push({ userId, roleId: body.role_id });
        const user = users.find((u) => u.id === userId)!;
        user.role_id = body.role_id;
        return Promise.resolve(jsonResponse(user));
      }
      if (method === 'POST' && /\/users\/(\d+)\/deactivate$/.test(url)) {
        const userId = Number(/\/users\/(\d+)\/deactivate$/.exec(url)![1]);
        deactivateCalls.push(userId);
        const user = users.find((u) => u.id === userId)!;
        user.is_active = false;
        return Promise.resolve(jsonResponse(user));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls, patchCalls, deactivateCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UsersPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('UsersPage', () => {
  it('lists the existing users', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByText('Cajero Dos')).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
  });

  it('does not offer to deactivate the signed-in user themselves', async () => {
    stubBackend();
    renderPage();

    await screen.findByText('Admin Uno');

    // Only one "Desactivar" button: the other user's row, not the admin's own.
    expect(screen.getAllByRole('button', { name: 'Desactivar' })).toHaveLength(1);
  });

  it('creates a user with the chosen role', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Admin Uno');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo usuario' }));
    await userEvent.type(screen.getByLabelText('Email'), 'nuevo@example.com');
    await userEvent.type(screen.getByLabelText('Nombre completo'), 'Nuevo Usuario');
    await userEvent.type(screen.getByLabelText('Contraseña provisional'), 'una-clave-larga');
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'CASHIER');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Nuevo Usuario')).toBeInTheDocument();
    expect(backend.createCalls).toEqual([
      {
        email: 'nuevo@example.com',
        full_name: 'Nuevo Usuario',
        password: 'una-clave-larga',
        role_id: 3,
      },
    ]);
  });

  it('shows a clear error when the email is already taken', async () => {
    stubBackend();
    renderPage();
    await screen.findByText('Admin Uno');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo usuario' }));
    await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
    await userEvent.type(screen.getByLabelText('Nombre completo'), 'Otro Admin');
    await userEvent.type(screen.getByLabelText('Contraseña provisional'), 'una-clave-larga');
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'ADMIN');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Ya existe un usuario con ese email.')).toBeInTheDocument();
  });

  it('deactivating a user calls the deactivate endpoint', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Cajero Dos');

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));

    await screen.findByText('Inactivo');
    expect(backend.deactivateCalls).toEqual([2]);
  });

  it('changing a user role calls the update endpoint', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Cajero Dos');

    await userEvent.selectOptions(screen.getByLabelText('Rol de Cajero Dos'), 'ADMIN');

    expect(backend.patchCalls).toEqual([{ userId: 2, roleId: 1 }]);
  });
});
