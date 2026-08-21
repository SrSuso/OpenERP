import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EChartLoadErrorBoundary } from './EChartLoadErrorBoundary';

function BrokenChart(): never {
  throw new Error('Failed to fetch dynamically imported module');
}

describe('EChartLoadErrorBoundary', () => {
  it('keeps a failed lazy chart out of the router error screen and offers refresh', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <EChartLoadErrorBoundary height={240}>
        <BrokenChart />
      </EChartLoadErrorBoundary>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido cargar el gráfico');
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar pantalla' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
