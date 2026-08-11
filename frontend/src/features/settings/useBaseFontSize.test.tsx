import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBaseFontSize } from './useBaseFontSize';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function Probe() {
  useBaseFontSize();
  return null;
}

function renderWithSetting(values: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(values))),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('useBaseFontSize', () => {
  afterEach(() => {
    document.documentElement.style.fontSize = '';
    vi.unstubAllGlobals();
  });

  it('scales the whole app from the shop setting', async () => {
    renderWithSetting({ 'ui.base_font_px': '20' });

    await waitFor(() => expect(document.documentElement.style.fontSize).toBe('20px'));
  });

  it('falls back to the browser default on an absurd value', async () => {
    // Nada puede dejar la aplicación ilegible: ni un valor disparatado
    // guardado a mano por la API, ni un ajuste que no se haya podido leer.
    renderWithSetting({ 'ui.base_font_px': '900' });

    await waitFor(() => expect(document.documentElement.style.fontSize).toBe('16px'));
  });

  it('leaves the size behind it when it unmounts', async () => {
    // La pantalla de entrada se pinta sin sesión, así que no puede quedarse
    // con el tamaño de la tienda pegado.
    const { unmount } = renderWithSetting({ 'ui.base_font_px': '22' });
    await waitFor(() => expect(document.documentElement.style.fontSize).toBe('22px'));

    unmount();

    expect(document.documentElement.style.fontSize).toBe('');
  });
});
