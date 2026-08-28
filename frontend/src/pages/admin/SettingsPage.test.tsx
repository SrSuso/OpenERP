import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { settingsValuesQuery, type SettingsOptions } from '@/features/settings/optionsApi';

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

/** Una muestra del registro real (backend/app/settings/registry.py) con un
 * ajuste de cada tipo: la pantalla no conoce ninguna de estas claves, las
 * pinta a partir de esta respuesta. */
const DEFAULT_OPTIONS: SettingsOptions = {
  groups: ['Datos de la tienda', 'Ticket', 'Ventas', 'Avisos', 'Pantalla'],
  settings: [
    {
      key: 'store.name',
      group: 'Datos de la tienda',
      label: 'Nombre de la tienda',
      help: 'Se imprime arriba del todo en el ticket.',
      type: 'STRING',
      value: '',
      is_set: false,
      default: '',
      choices: [],
      minimum: null,
      maximum: null,
      caution: null,
    },
    {
      key: 'store.address',
      group: 'Datos de la tienda',
      label: 'Dirección',
      help: 'Una línea por renglón.',
      type: 'TEXT',
      value: 'Calle Mayor 1',
      is_set: false,
      default: '',
      choices: [],
      minimum: null,
      maximum: null,
      caution: null,
    },
    {
      key: 'business.timezone',
      group: 'Datos de la tienda',
      label: 'Zona horaria comercial',
      help: 'Calendario y hora de la tienda para mostrar y filtrar operaciones.',
      type: 'TIMEZONE',
      value: 'Europe/Madrid',
      is_set: false,
      default: 'Europe/Madrid',
      choices: [],
      minimum: null,
      maximum: null,
      caution: null,
    },
    {
      key: 'ticket.date_format',
      group: 'Ticket',
      label: 'Formato de la fecha',
      help: 'Cómo se escribe la fecha y la hora de la venta.',
      type: 'ENUM',
      value: '%Y-%m-%d %H:%M',
      is_set: false,
      default: '%Y-%m-%d %H:%M',
      choices: [
        { value: '%d/%m/%Y %H:%M', label: '31/12/2026 14:05' },
        { value: '%Y-%m-%d %H:%M', label: '2026-12-31 14:05' },
      ],
      minimum: null,
      maximum: null,
      caution: null,
    },
    {
      key: 'ticket.show_cashier',
      group: 'Ticket',
      label: 'Mostrar quién ha atendido',
      help: 'Añade el nombre del cajero bajo la fecha.',
      type: 'BOOL',
      value: 'false',
      is_set: false,
      default: 'false',
      choices: [],
      minimum: null,
      maximum: null,
      caution: null,
    },
    {
      key: 'sales.max_discount_rate',
      group: 'Ventas',
      label: 'Descuento máximo por línea (%)',
      help: 'Tope de descuento que se puede aplicar a una línea de venta.',
      type: 'DECIMAL',
      value: '100',
      is_set: false,
      default: '100',
      choices: [],
      minimum: '0',
      maximum: '100',
      caution: null,
    },
    {
      key: 'sales.allow_negative_stock',
      group: 'Ventas',
      label: 'Dejar vender sin existencias suficientes',
      help: 'Hoy la caja bloquea la venta si el inventario no llega.',
      type: 'BOOL',
      value: 'false',
      is_set: false,
      default: 'false',
      choices: [],
      minimum: null,
      maximum: null,
      caution: 'Con esto activado el stock puede quedarse en negativo.',
    },
    {
      key: 'ui.button_color',
      group: 'Pantalla',
      label: 'Color de los botones del panel',
      help: 'Del color que elijas se toma el tono.',
      type: 'COLOR',
      value: '#2b5bb5',
      is_set: false,
      default: '#2b5bb5',
      choices: [],
      minimum: null,
      maximum: null,
      caution: null,
    },
  ],
};

interface BackendStub {
  /** El `values` de cada `PUT /settings/options`. */
  optionsPutCalls: Record<string, string>[];
}

function stubBackend(options?: { optionsError?: string }): BackendStub {
  let optionValues: SettingsOptions = {
    groups: [...DEFAULT_OPTIONS.groups],
    settings: DEFAULT_OPTIONS.settings.map((definition) => ({ ...definition })),
  };
  const optionsPutCalls: Record<string, string>[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));

      if (url.includes('/settings/options')) {
        if (method === 'PUT') {
          const values = body()['values'] as Record<string, string>;
          optionsPutCalls.push(values);
          if (options?.optionsError) {
            return Promise.resolve(
              jsonResponse(
                { error: { code: 'validation_error', message: options.optionsError } },
                { status: 422 },
              ),
            );
          }
          optionValues = {
            ...optionValues,
            settings: optionValues.settings.map((definition) =>
              definition.key in values
                ? { ...definition, value: values[definition.key] ?? definition.value }
                : definition,
            ),
          };
        }
        return Promise.resolve(jsonResponse(optionValues));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { optionsPutCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('SettingsPage — opciones del registro', () => {
  it('shows business settings without infrastructure or SMTP controls', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByLabelText('Zona horaria comercial')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Servidor (avanzado)' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Dirección de la base de datos')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument();
  });

  it('paints one card per group and the right control for every type', async () => {
    stubBackend();
    renderPage();

    for (const group of DEFAULT_OPTIONS.groups) {
      expect(await screen.findByRole('heading', { name: group })).toBeInTheDocument();
    }

    expect(screen.getByLabelText('Nombre de la tienda')).toHaveProperty('type', 'text');
    expect(screen.getByLabelText('Dirección').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Formato de la fecha').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Mostrar quién ha atendido')).toHaveProperty('type', 'checkbox');

    // Nunca `type="number"`: el repo usa texto con el teclado adecuado.
    const discount = screen.getByLabelText('Descuento máximo por línea (%)');
    expect(discount).toHaveProperty('type', 'text');
    expect(discount).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText('Días de antelación para avisar de caducidades')).toHaveAttribute(
      'inputmode',
      'numeric',
    );

    // Las choices del ENUM salen como opciones, con su etiqueta legible.
    expect(screen.getByRole('option', { name: '31/12/2026 14:05' })).toBeInTheDocument();

    // La ayuda se lee sin descubrirla, y el aviso se destaca.
    expect(screen.getByText(/Se imprime arriba del todo en el ticket/)).toBeInTheDocument();
    expect(
      screen.getByText(/Con esto activado el stock puede quedarse en negativo/),
    ).toBeInTheDocument();
    // Los límites del registro se anuncian antes de escribir, no en el 422.
    expect(screen.getByText(/Tope de descuento.*Entre 0 y 100\./)).toBeInTheDocument();
  });

  it('saves exactly the keys that changed in that card, and nothing else', async () => {
    const backend = stubBackend();
    renderPage();

    const save = await screen.findByRole('button', {
      name: 'Guardar cambios de Datos de la tienda',
    });
    const storeCard = screen.getByRole('heading', { name: 'Datos de la tienda' }).parentElement!;
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Nombre de la tienda'), 'Frutería Pepa');
    expect(within(storeCard).getByText('Sin guardar')).toBeInTheDocument();
    expect(save).toBeEnabled();

    // Otra tarjeta con cambios propios no debe colarse en este guardado.
    await userEvent.click(screen.getByLabelText('Mostrar quién ha atendido'));

    await userEvent.click(save);

    await within(storeCard).findByText('Guardado. Ya está aplicado en la tienda.');
    expect(backend.optionsPutCalls).toEqual([{ 'store.name': 'Frutería Pepa' }]);
    expect(within(storeCard).queryByText('Sin guardar')).not.toBeInTheDocument();

    // El cambio de la otra tarjeta sigue pendiente, no se ha perdido.
    const ticketCard = screen.getByRole('heading', { name: 'Ticket' }).parentElement!;
    expect(within(ticketCard).getByText('Sin guardar')).toBeInTheDocument();
  });

  it('refreshes the read-only values cache when the business timezone changes', async () => {
    const backend = stubBackend();
    const queryClient = renderPage();
    const timezone = await screen.findByLabelText('Zona horaria comercial');
    await userEvent.clear(timezone);
    await userEvent.type(timezone, 'Europe/Lisbon');

    await userEvent.click(
      screen.getByRole('button', { name: 'Guardar cambios de Datos de la tienda' }),
    );
    await screen.findByText('Guardado. Ya está aplicado en la tienda.');

    expect(backend.optionsPutCalls).toEqual([{ 'business.timezone': 'Europe/Lisbon' }]);
    expect(queryClient.getQueryData(settingsValuesQuery.queryKey)).toMatchObject({
      'business.timezone': 'Europe/Lisbon',
    });
  });

  it('restores a field to its default value, and only offers it when it differs', async () => {
    const backend = stubBackend();
    renderPage();

    const reset = await screen.findByRole('button', { name: 'Restablecer Dirección' });
    // `store.name` ya está en su valor por defecto: no hay nada que restablecer.
    expect(
      screen.queryByRole('button', { name: 'Restablecer Nombre de la tienda' }),
    ).not.toBeInTheDocument();

    await userEvent.click(reset);
    expect(screen.getByLabelText('Dirección')).toHaveValue('');

    await userEvent.click(
      screen.getByRole('button', { name: 'Guardar cambios de Datos de la tienda' }),
    );
    await screen.findByText('Guardado. Ya está aplicado en la tienda.');
    expect(backend.optionsPutCalls).toEqual([{ 'store.address': '' }]);
  });

  it("shows the backend's 422 message next to the card it came from", async () => {
    stubBackend({
      optionsError: 'Descuento máximo por línea (%): no puede ser mayor que 100.',
    });
    renderPage();

    const save = await screen.findByRole('button', { name: 'Guardar cambios de Ventas' });
    const discount = screen.getByLabelText('Descuento máximo por línea (%)');
    await userEvent.clear(discount);
    await userEvent.type(discount, '150');
    await userEvent.click(save);

    const salesCard = screen.getByRole('heading', { name: 'Ventas' }).parentElement!;
    expect(
      await within(salesCard).findByText(
        'Descuento máximo por línea (%): no puede ser mayor que 100.',
      ),
    ).toBeInTheDocument();
    // Lo escrito sigue ahí para corregirlo, no se ha descartado.
    expect(discount).toHaveValue('150');
  });

  it('picks a colour from a colour box, not by typing a hex code', async () => {
    const backend = stubBackend();
    renderPage();
    await screen.findByText('Pantalla');

    const field = screen.getByLabelText('Color de los botones del panel');
    expect(field).toHaveAttribute('type', 'color');
    expect(field).toHaveValue('#2b5bb5');

    fireEvent.change(field, { target: { value: '#22c55e' } });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios de Pantalla' }));

    expect(backend.optionsPutCalls).toEqual([{ 'ui.button_color': '#22c55e' }]);
  });

  it('filters the options by label and help text', async () => {
    stubBackend();
    renderPage();

    await screen.findByLabelText('Nombre de la tienda');
    await userEvent.type(screen.getByLabelText('Buscar una opción'), 'descuento');

    expect(screen.getByLabelText('Descuento máximo por línea (%)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre de la tienda')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Datos de la tienda' })).not.toBeInTheDocument();
  });

  it('matches the help text and ignores accents while searching', async () => {
    stubBackend();
    renderPage();

    await screen.findByLabelText('Nombre de la tienda');
    // "cajero" sólo aparece en la ayuda, y sin la tilde de "línea".
    await userEvent.type(screen.getByLabelText('Buscar una opción'), 'cajero');
    expect(screen.getByLabelText('Mostrar quién ha atendido')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre de la tienda')).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Buscar una opción'));
    await userEvent.type(screen.getByLabelText('Buscar una opción'), 'linea');
    expect(screen.getByLabelText('Descuento máximo por línea (%)')).toBeInTheDocument();
  });
});
