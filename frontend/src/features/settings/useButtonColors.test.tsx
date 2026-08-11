import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexToOklch } from '@/lib/oklch';

import { useButtonColors } from './useButtonColors';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function Probe() {
  useButtonColors();
  return null;
}

function renderWithSettings(values: Record<string, string>) {
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

function variable(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

describe('useButtonColors', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    vi.unstubAllGlobals();
  });

  it('repaints the buttons with the chosen hue', async () => {
    // Rojo puro: tono ~29 en OkLCH.
    renderWithSettings({ 'ui.button_color': '#ff0000' });

    // Esperando al color pedido, no a que haya "algún" color: el efecto
    // pinta primero con el de fábrica y repinta al llegar el ajuste.
    const hue = hexToOklch('#ff0000')!.h;
    await waitFor(() => expect(variable('--color-brand-700')).toContain(hue.toFixed(1)));
  });

  it('keeps the designed lightness so the label stays readable', async () => {
    // Un amarillo clarísimo puesto tal cual dejaría letra blanca sobre
    // amarillo: del color elegido se toma el tono, no la claridad.
    renderWithSettings({ 'ui.button_color': '#fff59d' });

    const hue = hexToOklch('#fff59d')!.h;
    await waitFor(() => expect(variable('--color-brand-700')).toContain(hue.toFixed(1)));
    expect(variable('--color-brand-700')).toMatch(/^oklch\(0\.440 /);
    expect(variable('--color-brand-50')).toMatch(/^oklch\(0\.970 /);
  });

  it('paints the till buttons from their own setting', async () => {
    renderWithSettings({ 'ui.button_color': '#ff0000', 'ui.pos_button_color': '#0000ff' });

    await waitFor(() =>
      expect(variable('--color-till-600')).toContain(hexToOklch('#0000ff')!.h.toFixed(1)),
    );
    // Y no se contagian entre ellos: son dos familias distintas a propósito.
    expect(variable('--color-brand-700')).toContain(hexToOklch('#ff0000')!.h.toFixed(1));
  });

  it('falls back to the factory colour when the value is not a colour', async () => {
    renderWithSettings({ 'ui.button_color': 'azul marino' });

    await waitFor(() =>
      expect(variable('--color-brand-700')).toContain(hexToOklch('#2b5bb5')!.h.toFixed(1)),
    );
  });
});
