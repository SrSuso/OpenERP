import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePosAppearance } from './usePosAppearance';

function Probe() {
  const { surfaceColor } = usePosAppearance();
  return <output>{surfaceColor}</output>;
}

function renderWithSettings(values: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(values), { headers: { 'Content-Type': 'application/json' } }),
      ),
    ),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('usePosAppearance', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    vi.unstubAllGlobals();
  });

  it('scales the POS from its own setting and accepts a configured surface colour', async () => {
    renderWithSettings({ 'pos.font_size_px': '22', 'pos.surface_color': '#123456' });

    await waitFor(() => expect(document.documentElement.style.fontSize).toBe('22px'));
    expect(screen.getByText('#123456')).toBeInTheDocument();
  });

  it('uses the exact configured colours for the rest of the POS surface', async () => {
    renderWithSettings({
      'pos.surface_color': '#000000',
      'pos.panel_color': '#112233',
      'pos.border_color': '#445566',
      'pos.text_color': '#778899',
      'pos.muted_text_color': '#aabbcc',
      'pos.amount_color': '#ddee00',
      'pos.input_background_color': '#111111',
      'pos.input_text_color': '#eeeeee',
    });

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--pos-surface-color')).toBe(
        '#000000',
      ),
    );
    expect(document.documentElement.style.getPropertyValue('--pos-panel-color')).toBe('#112233');
    expect(document.documentElement.style.getPropertyValue('--pos-border-color')).toBe('#445566');
    expect(document.documentElement.style.getPropertyValue('--pos-text-color')).toBe('#778899');
    expect(document.documentElement.style.getPropertyValue('--pos-muted-text-color')).toBe(
      '#aabbcc',
    );
    expect(document.documentElement.style.getPropertyValue('--pos-amount-color')).toBe('#ddee00');
    expect(document.documentElement.style.getPropertyValue('--pos-input-background-color')).toBe(
      '#111111',
    );
    expect(document.documentElement.style.getPropertyValue('--pos-input-text-color')).toBe(
      '#eeeeee',
    );
  });

  it('falls back to the safe default size when the setting is invalid', async () => {
    renderWithSettings({ 'pos.font_size_px': '900' });

    await waitFor(() => expect(document.documentElement.style.fontSize).toBe('18px'));
  });
});
