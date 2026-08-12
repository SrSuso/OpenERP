import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLiveCatalog } from './useLiveCatalog';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

/** El intervalo sale de un ajuste, así que la caja tiene que leerlo antes
 * de poder empezar a refrescar. */
function stubSettings(values: Record<string, string> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/settings/values')) return Promise.resolve(jsonResponse(values));
      return Promise.reject(new Error(`Unexpected fetch to ${url} in test`));
    }),
  );
}

function setup(values?: Record<string, string>) {
  stubSettings(values);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const rendered = renderHook(() => useLiveCatalog(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...rendered, invalidate };
}

/** Qué se ha mandado refrescar, como texto legible ("pos/products"). */
function invalidatedKeys(invalidate: { mock: { calls: unknown[][] } }): string[] {
  return invalidate.mock.calls.map((call) =>
    (call[0] as { queryKey: readonly string[] }).queryKey.join('/'),
  );
}

describe('useLiveCatalog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('re-asks for the catalog on its own, so a change made in the panel shows up', async () => {
    const { invalidate } = setup({ 'pos.catalog_refresh_seconds': '5' });
    // Espera a que el ajuste esté cargado: hasta entonces el intervalo es
    // el de por defecto.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    invalidate.mockClear();

    await vi.advanceTimersByTimeAsync(5_000);

    // Precios y productos, botones del TPV, ajustes de tienda y la
    // plantilla del ticket: todo lo que se cambia desde el panel.
    expect(invalidatedKeys(invalidate)).toEqual([
      'pos/products',
      'pos/categories',
      'settings/values',
      'tickets/templates',
    ]);
  });

  it('refreshes at once when another tab saves something', async () => {
    const { invalidate } = setup();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    invalidate.mockClear();

    // Lo que hace el panel al guardar, desde su propia pestaña.
    const bus = new BroadcastChannel('openerp-changes');
    bus.postMessage('changed');
    bus.close();

    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toContain('pos/products');
    });
  });

  it('refreshes when the till window comes back to the front', async () => {
    const { invalidate } = setup();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    invalidate.mockClear();

    window.dispatchEvent(new Event('focus'));

    expect(invalidatedKeys(invalidate)).toContain('pos/products');
  });

  it('stops asking once the till screen is gone', async () => {
    const { invalidate, unmount } = setup({ 'pos.catalog_refresh_seconds': '5' });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    unmount();
    invalidate.mockClear();

    await vi.advanceTimersByTimeAsync(20_000);
    window.dispatchEvent(new Event('focus'));

    expect(invalidate).not.toHaveBeenCalled();
  });
});
