import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';

import { PricingFormulaPage } from './PricingFormulaPage';

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
  permissions: ['admin.access', 'pricing.manage'],
};

const DEFAULT_FORMULA =
  '(cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)';

function stubBackend(options: { previewOk?: boolean; saveOk?: boolean } = {}) {
  let formula = DEFAULT_FORMULA;
  const saveCalls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && url.includes('/pricing/settings')) {
        return Promise.resolve(jsonResponse({ formula }));
      }
      if (method === 'POST' && url.includes('/pricing/preview')) {
        if (options.previewOk === false) {
          return Promise.resolve(
            jsonResponse(
              { error: { code: 'validation_error', message: 'bad formula' } },
              { status: 422 },
            ),
          );
        }
        return Promise.resolve(jsonResponse({ result: '15.120000' }));
      }
      if (method === 'PUT' && url.includes('/pricing/settings')) {
        const body = init?.body
          ? (JSON.parse(init.body as string) as { formula: string })
          : { formula: '' };
        if (options.saveOk === false) {
          return Promise.resolve(
            jsonResponse(
              { error: { code: 'validation_error', message: 'bad formula' } },
              { status: 422 },
            ),
          );
        }
        saveCalls.push(body.formula);
        formula = body.formula;
        return Promise.resolve(jsonResponse({ formula }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { saveCalls };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PricingFormulaPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('PricingFormulaPage', () => {
  it('shows the current store formula', async () => {
    stubBackend();
    renderPage();

    expect(await screen.findByDisplayValue(DEFAULT_FORMULA)).toBeInTheDocument();
  });

  it('previews the formula against sample values', async () => {
    stubBackend();
    renderPage();
    await screen.findByDisplayValue(DEFAULT_FORMULA);

    await userEvent.click(
      screen.getByRole('button', { name: /Probar con coste 10€, IVA 21%, margen 20%/ }),
    );

    expect(await screen.findByText(/15,12/)).toBeInTheDocument();
  });

  it('saves an edited formula', async () => {
    const backend = stubBackend();
    renderPage();
    const textarea = await screen.findByDisplayValue(DEFAULT_FORMULA);

    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'cost * 2');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar fórmula' }));

    expect(await screen.findByText(/recalculado/)).toBeInTheDocument();
    expect(backend.saveCalls).toEqual(['cost * 2']);
  });

  it('shows an error when the formula is rejected', async () => {
    stubBackend({ saveOk: false });
    renderPage();
    const textarea = await screen.findByDisplayValue(DEFAULT_FORMULA);

    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'cost.__class__');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar fórmula' }));

    expect(await screen.findByText(/no válida/)).toBeInTheDocument();
  });
});
