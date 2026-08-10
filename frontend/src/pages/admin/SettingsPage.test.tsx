import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type SystemSettings } from '@/features/settings/api';

import { SettingsPage } from './SettingsPage';

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
  permissions: ['admin.access', 'settings.read', 'settings.manage'],
};

const DEFAULT_SETTINGS: SystemSettings = {
  smtp_host: '127.0.0.1',
  smtp_port: 1025,
  smtp_use_tls: false,
  smtp_username: null,
  smtp_password_set: false,
  smtp_from_email: 'no-reply@openerp.local',
  notification_recipient_email: null,
  updated_at: null,
};

function stubBackend() {
  let settings: SystemSettings = { ...DEFAULT_SETTINGS };
  const putCalls: Record<string, unknown>[] = [];
  const testCalls: Record<string, unknown>[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/settings/smtp')) {
        return Promise.resolve(jsonResponse(settings));
      }
      if (method === 'PUT' && url.includes('/settings/smtp')) {
        const b = body();
        putCalls.push(b);
        settings = {
          ...settings,
          ...(b['smtp_host'] !== undefined ? { smtp_host: b['smtp_host'] as string } : {}),
          ...(b['smtp_port'] !== undefined ? { smtp_port: b['smtp_port'] as number } : {}),
          ...(b['smtp_use_tls'] !== undefined
            ? { smtp_use_tls: b['smtp_use_tls'] as boolean }
            : {}),
          ...(b['smtp_password'] ? { smtp_password_set: true } : {}),
          updated_at: '2026-08-10T12:00:00Z',
        };
        return Promise.resolve(jsonResponse(settings));
      }
      if (method === 'POST' && url.includes('/settings/smtp/test')) {
        testCalls.push(body());
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { putCalls, testCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  it('loads the current SMTP config, saves a change, and leaves the password alone', async () => {
    const backend = stubBackend();
    renderPage();

    expect(await screen.findByDisplayValue('127.0.0.1')).toBeInTheDocument();

    const hostInput = screen.getByLabelText('Host');
    await userEvent.clear(hostInput);
    await userEvent.type(hostInput, 'smtp.miempresa.com');
    const portInput = screen.getByLabelText('Puerto');
    await userEvent.clear(portInput);
    await userEvent.type(portInput, '587');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await screen.findByText('Configuración guardada.');
    expect(backend.putCalls).toEqual([
      {
        smtp_host: 'smtp.miempresa.com',
        smtp_port: 587,
        smtp_use_tls: false,
        smtp_username: '',
        smtp_from_email: 'no-reply@openerp.local',
        notification_recipient_email: '',
      },
    ]);
  });

  it('sends a test email using whatever is currently in the form', async () => {
    const backend = stubBackend();
    renderPage();

    await screen.findByDisplayValue('127.0.0.1');
    await userEvent.type(screen.getByLabelText('Enviar correo de prueba a'), 'destino@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar correo de prueba' }));

    await screen.findByText('Correo de prueba enviado.');
    expect(backend.testCalls).toEqual([
      {
        to_email: 'destino@example.com',
        smtp_host: '127.0.0.1',
        smtp_port: 1025,
        smtp_use_tls: false,
        smtp_username: '',
        smtp_from_email: 'no-reply@openerp.local',
      },
    ]);
  });
});
