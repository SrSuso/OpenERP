import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const qzMocks = vi.hoisted(() => ({
  testConnection: vi.fn(() =>
    Promise.resolve({ printerName: 'Caja charcutería', signingEnabled: true }),
  ),
}));

vi.mock('@/features/tickets/qzPrinter', () => ({
  testQzPrinterConnection: qzMocks.testConnection,
}));

import { PosTerminalsPage } from './PosTerminalsPage';
import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function stubBackend() {
  let terminals = [
    {
      id: 7,
      name: 'Caja 1',
      warehouse_id: 1,
      warehouse_name: 'Tienda',
      is_active: true,
      show_product_search: true,
      created_at: '2026-08-11T09:00:00Z',
    },
  ];
  const writes: Record<string, unknown>[] = [];
  let posSettings = [
    {
      key: 'pos.surface_color',
      group: 'Caja (TPV)',
      label: 'Color de fondo del TPV',
      help: 'El fondo principal de la pantalla de venta.',
      type: 'COLOR',
      value: '#0f172a',
      is_set: false,
      default: '#0f172a',
      choices: [],
      minimum: null,
      maximum: null,
      caution: null,
    },
    {
      key: 'pos.font_size_px',
      group: 'Caja (TPV)',
      label: 'Tamaño de letra del TPV',
      help: 'Aumenta el texto y los controles táctiles de la caja.',
      type: 'INT',
      value: '18',
      is_set: false,
      default: '18',
      choices: [],
      minimum: '14',
      maximum: '28',
      caution: null,
    },
    {
      key: 'pos.qz_host',
      group: 'Impresión QZ Tray',
      label: 'Servidor QZ (IP o nombre completo)',
      help: 'Equipo Windows donde se ejecuta QZ Tray en la red local.',
      type: 'HOST',
      value: '192.168.1.50',
      is_set: true,
      default: 'localhost',
      choices: [],
      minimum: null,
      maximum: null,
      caution: null,
    },
    {
      key: 'pos.qz_secure_port',
      group: 'Impresión QZ Tray',
      label: 'Puerto seguro de QZ',
      help: 'Puerto WSS seguro en el que escucha QZ Tray.',
      type: 'ENUM',
      value: '8181',
      is_set: true,
      default: '8181',
      choices: [{ value: '8181', label: '8181 (principal)' }],
      minimum: null,
      maximum: null,
      caution: null,
    },
    {
      key: 'pos.qz_printer_name',
      group: 'Impresión QZ Tray',
      label: 'Nombre de la impresora en Windows',
      help: 'Nombre exacto de la cola de impresión en el ordenador Windows.',
      type: 'STRING',
      value: 'Caja charcutería',
      is_set: true,
      default: 'POSPrinter POS-80',
      choices: [],
      minimum: null,
      maximum: null,
      caution: null,
    },
  ];
  let coldDrinkSurcharge = {
    key: 'pos.cold_drink_surcharge_amount',
    group: 'Caja (TPV)',
    label: 'Recargo por bebida fría (por unidad)',
    help: 'Importe final que suma la caja a cada unidad marcada como bebida fría.',
    type: 'DECIMAL',
    value: '0.20',
    is_set: true,
    default: '0',
    choices: [],
    minimum: '0',
    maximum: '100',
    caution: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (method === 'GET' && url.includes('/pos-terminals')) {
        return Promise.resolve(jsonResponse(terminals));
      }
      if (method === 'GET' && url.includes('/warehouses')) {
        return Promise.resolve(jsonResponse([{ id: 1, name: 'Tienda', is_active: true }]));
      }
      if (method === 'GET' && url.includes('/settings/options')) {
        return Promise.resolve(
          jsonResponse({ groups: ['Caja (TPV)', 'Impresión QZ Tray'], settings: posSettings }),
        );
      }
      if (method === 'GET' && url.includes('/settings/pos/cold-drink-surcharge')) {
        return Promise.resolve(jsonResponse(coldDrinkSurcharge));
      }
      if (method === 'PUT' && url.includes('/settings/pos/cold-drink-surcharge')) {
        coldDrinkSurcharge = {
          ...coldDrinkSurcharge,
          value: body['amount'] as string,
          is_set: true,
        };
        writes.push(body);
        return Promise.resolve(jsonResponse(coldDrinkSurcharge));
      }
      if (method === 'GET' && url.includes('/settings/values')) {
        return Promise.resolve(
          jsonResponse(
            Object.fromEntries(posSettings.map((setting) => [setting.key, setting.value])),
          ),
        );
      }
      if (method === 'PUT' && url.includes('/settings/options')) {
        writes.push(body);
        const updates = body['values'] as Record<string, string>;
        posSettings = posSettings.map((setting) => {
          const updatedValue = updates[setting.key];
          return updatedValue === undefined
            ? setting
            : { ...setting, value: updatedValue, is_set: true };
        });
        return Promise.resolve(
          jsonResponse({ groups: ['Caja (TPV)', 'Impresión QZ Tray'], settings: posSettings }),
        );
      }
      if (method === 'POST' && /\/pos-terminals$/.test(url)) {
        writes.push(body);
        const created = {
          id: 8,
          name: body['name'],
          warehouse_id: body['warehouse_id'],
          warehouse_name: 'Tienda',
          is_active: true,
          show_product_search: true,
          created_at: '2026-08-11T10:00:00Z',
        };
        terminals = [...terminals, created as (typeof terminals)[number]];
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const patch = /\/pos-terminals\/(\d+)$/.exec(url);
      if (method === 'PATCH' && patch) {
        writes.push(body);
        const id = Number(patch[1]);
        terminals = terminals.map((terminal) =>
          terminal.id === id ? { ...terminal, ...body } : terminal,
        );
        return Promise.resolve(jsonResponse(terminals.find((terminal) => terminal.id === id)));
      }
      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url}`));
    }),
  );
  return { writes };
}

function renderPage({
  canReadSettings = true,
  canManageSettings = false,
  canManageColdDrinkSurcharge = false,
  canManageTerminals = true,
}: {
  canReadSettings?: boolean;
  canManageSettings?: boolean;
  canManageColdDrinkSurcharge?: boolean;
  canManageTerminals?: boolean;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth: AuthContextValue = {
    user: null,
    isLoading: false,
    hasPermission: (permission) =>
      (canReadSettings && permission === 'settings.read') ||
      (canManageSettings && permission === 'settings.manage') ||
      (canManageTerminals && permission === 'pos_terminal.manage') ||
      (canManageColdDrinkSurcharge && permission === 'pos.cold_drink_surcharge.manage'),
    login: vi.fn(),
    logout: vi.fn(),
    markPasswordChanged: vi.fn(),
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <PosTerminalsPage />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('PosTerminalsPage', () => {
  it('creates, renames and deactivates without offering warehouse reassignment or deletion', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByDisplayValue('Caja 1');

    await userEvent.type(screen.getByPlaceholderText('Caja 1'), 'Caja 2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir terminal' }));
    expect(await screen.findByDisplayValue('Caja 2')).toBeInTheDocument();
    expect(backend.writes).toContainEqual({ name: 'Caja 2', warehouse_id: 1 });

    const firstName = screen.getByLabelText('Nombre de Caja 1');
    await userEvent.clear(firstName);
    await userEvent.type(firstName, 'Caja principal');
    await userEvent.click(screen.getAllByRole('button', { name: 'Guardar nombre' })[0]!);
    await waitFor(() => expect(backend.writes).toContainEqual({ name: 'Caja principal' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Desactivar' })[0]!);
    await waitFor(() => expect(backend.writes).toContainEqual({ is_active: false }));
    await userEvent.click(screen.getByLabelText('Buscador táctil de Caja principal'));
    await waitFor(() => expect(backend.writes).toContainEqual({ show_product_search: false }));

    expect(screen.queryByRole('button', { name: /eliminar/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cambiar almacén/i)).not.toBeInTheDocument();
  });

  it('keeps the POS appearance and action buttons in the terminal configuration', async () => {
    const backend = stubBackend();
    renderPage({ canManageSettings: true });

    expect(
      await screen.findByRole('heading', { name: 'Pantalla y botones del TPV' }),
    ).toBeInTheDocument();
    const surface = await screen.findByLabelText('Color de fondo del TPV');
    fireEvent.change(surface, { target: { value: '#123456' } });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios de Caja (TPV)' }));

    await waitFor(() =>
      expect(backend.writes).toContainEqual({ values: { 'pos.surface_color': '#123456' } }),
    );
  });

  it('saves and tests the remote QZ destination from Terminales POS', async () => {
    const backend = stubBackend();
    renderPage({ canManageSettings: true });

    expect(
      await screen.findByRole('heading', { name: 'Impresión mediante QZ Tray' }),
    ).toBeInTheDocument();
    const host = await screen.findByLabelText('Servidor QZ (IP o nombre completo)');
    await userEvent.clear(host);
    await userEvent.type(host, '192.168.1.60');
    await userEvent.click(
      screen.getByRole('button', { name: 'Guardar cambios de Impresión QZ Tray' }),
    );
    await waitFor(() =>
      expect(backend.writes).toContainEqual({
        values: {
          'pos.qz_host': '192.168.1.60',
        },
      }),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Probar conexión e impresora guardadas' }),
    );
    await waitFor(() =>
      expect(qzMocks.testConnection).toHaveBeenCalledWith({
        host: '192.168.1.60',
        securePort: 8181,
        printerName: 'Caja charcutería',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Firma silenciosa: activa');
  });

  it('shows only the delegated cold-drink amount to a manager role', async () => {
    const backend = stubBackend();
    renderPage({
      canReadSettings: false,
      canManageTerminals: false,
      canManageColdDrinkSurcharge: true,
    });

    const amount = await screen.findByLabelText('Recargo por bebida fría (por unidad)');
    fireEvent.change(amount, { target: { value: '0,35' } });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar importe' }));

    await waitFor(() => expect(backend.writes).toContainEqual({ amount: '0.35' }));
    expect(screen.queryByText('Añadir terminal')).not.toBeInTheDocument();
    expect(screen.queryByText('Impresión mediante QZ Tray')).not.toBeInTheDocument();
  });
});
