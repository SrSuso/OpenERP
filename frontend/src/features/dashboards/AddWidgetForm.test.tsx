import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AddWidgetForm } from './AddWidgetForm';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function renderForm(overrides: Partial<Parameters<typeof AddWidgetForm>[0]> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/settings/values')) {
        return Promise.resolve(jsonResponse({ 'business.timezone': 'Europe/Madrid' }));
      }
      return Promise.resolve(jsonResponse([{ id: 1, name: 'Tienda principal', is_active: true }]));
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AddWidgetForm onSubmit={vi.fn()} onCancel={vi.fn()} isPending={false} {...overrides} />
    </QueryClientProvider>,
  );
}

describe('AddWidgetForm', () => {
  it('defaults to "Ventas por día" with a date range', () => {
    renderForm();

    expect(screen.getByLabelText(/desde/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hasta/i)).toBeInTheDocument();
  });

  it('uses today in the business timezone rather than the browser date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T22:30:00Z'));
    try {
      renderForm();

      const dateTo = screen.getByLabelText(/hasta/i);
      expect(dateTo).toHaveValue('2026-08-13');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows order/limit fields only for "Productos más vendidos"', async () => {
    renderForm();
    expect(screen.queryByLabelText(/ordenar por/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/métrica/i), 'Productos más vendidos');

    expect(screen.getByLabelText(/ordenar por/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/nº de productos/i)).toBeInTheDocument();
  });

  it('hides the date range for KPI metrics', async () => {
    renderForm();

    await userEvent.selectOptions(screen.getByLabelText(/métrica/i), 'Valor del inventario');

    expect(screen.queryByLabelText(/desde/i)).not.toBeInTheDocument();
  });

  it('submits with the metric, title and params', async () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    await userEvent.selectOptions(screen.getByLabelText(/métrica/i), 'Valor del inventario');

    await userEvent.click(screen.getByRole('button', { name: /^añadir$/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ metric: 'stock_value', chart_type: 'kpi' }),
    );
  });

  it('calls onCancel when "Cancelar" is tapped', async () => {
    const onCancel = vi.fn();
    renderForm({ onCancel });

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('lists warehouses fetched from the API', async () => {
    renderForm();

    expect(await screen.findByRole('option', { name: 'Tienda principal' })).toBeInTheDocument();
  });

  it('disables submitting while pending', () => {
    renderForm({ isPending: true });

    expect(screen.getByRole('button', { name: /añadiendo/i })).toBeDisabled();
  });
});
