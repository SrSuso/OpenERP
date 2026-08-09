import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type TicketTemplate } from '@/features/tickets/api';

import { TicketTemplatesPage } from './TicketTemplatesPage';

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
  permissions: ['admin.access', 'ticket.manage'],
};

function stubBackend() {
  let templates: TicketTemplate[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const reviseCalls: { id: number; body: Record<string, unknown> }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && /\/ticket-templates\/active$/.test(url)) {
        const active = templates.find((t) => t.is_active);
        return active
          ? Promise.resolve(jsonResponse(active))
          : Promise.resolve(
              jsonResponse(
                {
                  error: {
                    code: 'validation_error',
                    message: 'No hay plantilla activa.',
                    details: {},
                  },
                },
                { status: 422 },
              ),
            );
      }
      if (method === 'GET' && /\/ticket-templates$/.test(url)) {
        return Promise.resolve(jsonResponse(templates));
      }
      if (method === 'POST' && /\/ticket-templates$/.test(url)) {
        const b = body();
        createCalls.push(b);
        templates = templates.map((t) => ({ ...t, is_active: false }));
        const created: TicketTemplate = {
          id: templates.length + 1,
          name: b['name'] as string,
          version: 1,
          width_mm: b['width_mm'] as 58 | 80,
          header_text: (b['header_text'] as string) ?? '',
          footer_text: (b['footer_text'] as string) ?? '',
          show_tax_breakdown: b['show_tax_breakdown'] as boolean,
          is_active: true,
        };
        templates.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      const reviseMatch = /\/ticket-templates\/(\d+)\/revise$/.exec(url);
      if (method === 'POST' && reviseMatch) {
        const id = Number(reviseMatch[1]);
        const b = body();
        reviseCalls.push({ id, body: b });
        const current = templates.find((t) => t.id === id)!;
        current.is_active = false;
        const revised: TicketTemplate = {
          id: templates.length + 1,
          name: current.name,
          version: current.version + 1,
          width_mm: b['width_mm'] as 58 | 80,
          header_text: (b['header_text'] as string) ?? '',
          footer_text: (b['footer_text'] as string) ?? '',
          show_tax_breakdown: b['show_tax_breakdown'] as boolean,
          is_active: true,
        };
        templates.push(revised);
        return Promise.resolve(jsonResponse(revised));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { createCalls, reviseCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TicketTemplatesPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('TicketTemplatesPage', () => {
  it('creates the first template, then revises it into a new version', async () => {
    const backend = stubBackend();
    renderPage();

    await screen.findByText('Todavía no hay ninguna plantilla activa.');
    await userEvent.click(screen.getByRole('button', { name: 'Crear plantilla' }));

    await userEvent.type(screen.getByLabelText('Nombre'), 'Tienda principal');
    await userEvent.selectOptions(screen.getByLabelText('Ancho del papel'), '58');
    await userEvent.type(screen.getByLabelText('Cabecera'), 'Gracias por su compra');
    // La vista previa se actualiza en vivo mientras se escribe, antes de guardar nada.
    expect(screen.getByText(/Gracias por su compra/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await screen.findByText(/Activa: Tienda principal · v1 · 58 mm/);
    expect(backend.createCalls).toEqual([
      {
        name: 'Tienda principal',
        width_mm: 58,
        header_text: 'Gracias por su compra',
        footer_text: '',
        show_tax_breakdown: true,
      },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    const footerInput = screen.getByLabelText('Pie');
    await userEvent.type(footerInput, 'Vuelva pronto');
    expect(screen.getByText(/Vuelva pronto/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nueva versión' }));

    await screen.findByText(/Activa: Tienda principal · v2 · 58 mm/);
    expect(backend.reviseCalls).toEqual([
      {
        id: 1,
        body: {
          width_mm: 58,
          header_text: 'Gracias por su compra',
          footer_text: 'Vuelva pronto',
          show_tax_breakdown: true,
        },
      },
    ]);
  });
});
