import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLiveCatalog } from './useLiveCatalog';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

/** El backend visto desde la caja: los ajustes (de donde sale cada cuánto
 * preguntar) y la huella del catálogo, que aquí se cambia a mano para
 * simular que alguien ha guardado algo en el panel. */
function stubBackend(values: Record<string, string> = {}) {
  const state = { version: 'v1', versionCalls: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/settings/values')) return Promise.resolve(jsonResponse(values));
      if (url.includes('/catalog-version')) {
        state.versionCalls += 1;
        return Promise.resolve(jsonResponse({ version: state.version }));
      }
      return Promise.reject(new Error(`Unexpected fetch to ${url} in test`));
    }),
  );
  return state;
}

function setup(values?: Record<string, string>) {
  const backend = stubBackend(values);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const rendered = renderHook(() => useLiveCatalog(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...rendered, backend, invalidate };
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

  it('picks up a change made in the panel without anyone touching the till', async () => {
    const { backend, invalidate } = setup({ 'pos.catalog_refresh_seconds': '5' });
    await waitFor(() => expect(backend.versionCalls).toBeGreaterThan(0));
    invalidate.mockClear();

    // Alguien guarda un precio en el panel, en el otro equipo.
    backend.version = 'v2';
    await vi.advanceTimersByTimeAsync(5_000);

    // Precios y productos, botones del TPV, fotos, ajustes de tienda y la
    // plantilla del ticket: todo lo que se cambia desde el panel.
    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toEqual(
        expect.arrayContaining([
          'pos/products',
          'pos/categories',
          'images',
          // Las fotos van aparte: viajan como número de versión en la URL
          // de la imagen, no dentro del producto.
          'settings/values',
          'tickets/templates',
        ]),
      );
    });
  });

  it('does not reload the catalogue while nothing changes', async () => {
    const { backend, invalidate } = setup({ 'pos.catalog_refresh_seconds': '5' });
    await waitFor(() => expect(backend.versionCalls).toBeGreaterThan(0));
    invalidate.mockClear();

    await vi.advanceTimersByTimeAsync(20_000);

    // Ha preguntado varias veces —eso es lo barato— pero no se ha traído
    // el catálogo ni una sola vez.
    expect(backend.versionCalls).toBeGreaterThan(1);
    expect(invalidatedKeys(invalidate)).not.toContain('pos/products');
  });

  it('refreshes at once when another tab of the same browser saves something', async () => {
    const { backend, invalidate } = setup();
    await waitFor(() => expect(backend.versionCalls).toBeGreaterThan(0));
    invalidate.mockClear();

    // Lo que hace el panel al guardar, desde su propia pestaña.
    const bus = new BroadcastChannel('openerp-changes');
    bus.postMessage('changed');
    bus.close();

    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toContain('pos/products');
    });
  });

  it('checks again when the till window comes back to the front', async () => {
    const { backend, invalidate } = setup();
    await waitFor(() => expect(backend.versionCalls).toBeGreaterThan(0));
    invalidate.mockClear();

    window.dispatchEvent(new Event('focus'));

    expect(invalidatedKeys(invalidate)).toContain('pos/catalog-version');
  });

  it('stops asking once the till screen is gone', async () => {
    const { backend, unmount } = setup({ 'pos.catalog_refresh_seconds': '5' });
    await waitFor(() => expect(backend.versionCalls).toBeGreaterThan(0));
    unmount();
    const asked = backend.versionCalls;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(backend.versionCalls).toBe(asked);
  });
});
