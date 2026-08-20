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
    document.documentElement.style.fontSize = '';
    vi.unstubAllGlobals();
  });

  it('scales the POS from its own setting and accepts a configured surface colour', async () => {
    renderWithSettings({ 'pos.font_size_px': '22', 'pos.surface_color': '#123456' });

    await waitFor(() => expect(document.documentElement.style.fontSize).toBe('22px'));
    expect(screen.getByText('#123456')).toBeInTheDocument();
  });

  it('falls back to the safe default size when the setting is invalid', async () => {
    renderWithSettings({ 'pos.font_size_px': '900' });

    await waitFor(() => expect(document.documentElement.style.fontSize).toBe('18px'));
  });
});
