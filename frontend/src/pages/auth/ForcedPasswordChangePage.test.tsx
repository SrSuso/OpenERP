import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { RequireAuth } from '@/features/auth/guards';

import { ForcedPasswordChangePage } from './ForcedPasswordChangePage';

const FORCED_USER = {
  id: 7,
  email: 'temporary@example.com',
  full_name: 'Temporal',
  role: 'CASHIER',
  permissions: ['pos.access'],
  must_change_password: true,
};

function stubBackend() {
  const passwordChanges: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/auth/me')) {
        return Promise.resolve(Response.json(FORCED_USER));
      }
      if (url.includes('/users/me/password') && init?.method === 'POST') {
        passwordChanges.push(JSON.parse(init.body as string));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`Unexpected fetch to ${init?.method ?? 'GET'} ${url}`));
    }),
  );
  return passwordChanges;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<p>Acceso normal</p>} />
            <Route element={<RequireAuth />}>
              <Route path="/admin" element={<p>Panel normal</p>} />
              <Route path="/change-password" element={<ForcedPasswordChangePage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ForcedPasswordChangePage', () => {
  it('redirects a temporary-password session away from normal application routes', async () => {
    stubBackend();
    renderAt('/admin');

    expect(await screen.findByText('Elige una contraseña nueva')).toBeInTheDocument();
    expect(screen.queryByText('Panel normal')).not.toBeInTheDocument();
  });

  it('changes the password and then releases normal access', async () => {
    const passwordChanges = stubBackend();
    renderAt('/change-password');
    await screen.findByText('Elige una contraseña nueva');

    await userEvent.type(screen.getByLabelText('Contraseña actual'), 'temporary-password-42');
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'permanent-password-84');
    await userEvent.type(
      screen.getByLabelText('Repite la contraseña nueva'),
      'permanent-password-84',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Acceso normal')).toBeInTheDocument();
    expect(passwordChanges).toEqual([
      {
        current_password: 'temporary-password-42',
        new_password: 'permanent-password-84',
      },
    ]);
  });
});
