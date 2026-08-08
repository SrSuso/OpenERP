import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Widget } from './Widget';
import { type Widget as WidgetModel } from './api';

// jsdom has no real <canvas> (the `canvas` npm package isn't installed —
// same boundary as window.print() in E2E), so ECharts' CanvasRenderer
// throws once it actually tries to paint. Stand in for the two chart
// components here; what matters at this layer is that `Widget` parses the
// metric's data and hands it to the right one, not pixels — real
// rendering is exercised by Playwright, which has a real canvas.
vi.mock('./SalesOverTimeChart', () => ({
  SalesOverTimeChart: ({ points }: { points: unknown[] }) => (
    <div data-testid="sales-over-time-chart">{points.length} puntos</div>
  ),
}));
vi.mock('./TopProductsChart', () => ({
  TopProductsChart: ({ rows }: { rows: unknown[] }) => (
    <div data-testid="top-products-chart">{rows.length} filas</div>
  ),
}));

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function stubWidgetData(data: unknown, init?: ResponseInit) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse({ data }, init))),
  );
}

function renderWidget(widget: WidgetModel, overrides: Partial<Parameters<typeof Widget>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Widget
        dashboardId={1}
        widget={widget}
        onRemove={vi.fn()}
        isRemoving={false}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

const BASE_WIDGET: WidgetModel = {
  id: 1,
  dashboard_id: 1,
  metric: 'stock_value',
  title: 'Valor de inventario',
  params: {},
  chart_type: 'kpi',
  display_order: 0,
};

describe('Widget', () => {
  it('shows a loading state', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderWidget(BASE_WIDGET);

    expect(screen.getByText(/cargando/i)).toBeInTheDocument();
  });

  it('shows an error state when the query fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(jsonResponse({ error: { code: 'x', message: 'x' } }, { status: 500 })),
      ),
    );
    renderWidget(BASE_WIDGET);

    expect(await screen.findByText(/no se han podido cargar/i)).toBeInTheDocument();
  });

  it('renders a stock_value widget as a formatted KPI', async () => {
    stubWidgetData({ stock_value: '1234.560000' });
    renderWidget(BASE_WIDGET);

    expect(await screen.findByText('1234,56 €')).toBeInTheDocument();
  });

  it('renders a low_stock_count widget with a warning when above zero', async () => {
    stubWidgetData({ low_stock_count: 3 });
    renderWidget({ ...BASE_WIDGET, metric: 'low_stock_count', title: 'Stock bajo' });

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText(/por debajo del mínimo/i)).toBeInTheDocument();
  });

  it('renders a low_stock_count widget without a warning when zero', async () => {
    stubWidgetData({ low_stock_count: 0 });
    renderWidget({ ...BASE_WIDGET, metric: 'low_stock_count', title: 'Stock bajo' });

    expect(await screen.findByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/por debajo del mínimo/i)).not.toBeInTheDocument();
  });

  it('renders a sales_over_time widget as a chart', async () => {
    stubWidgetData([{ date: '2026-08-08', sales_count: 2, total: '50.000000' }]);
    renderWidget({
      ...BASE_WIDGET,
      metric: 'sales_over_time',
      title: 'Ventas',
      chart_type: 'line',
    });

    expect(await screen.findByTestId('sales-over-time-chart')).toBeInTheDocument();
  });

  it('shows an empty state for sales_over_time with no rows', async () => {
    stubWidgetData([]);
    renderWidget({
      ...BASE_WIDGET,
      metric: 'sales_over_time',
      title: 'Ventas',
      chart_type: 'line',
    });

    expect(await screen.findByText(/sin ventas en el rango elegido/i)).toBeInTheDocument();
  });

  it('renders a top_products widget as a chart', async () => {
    stubWidgetData([
      {
        product_id: 1,
        product_sku: 'A',
        product_name: 'Producto A',
        quantity: '5.000000',
        revenue: '50.000000',
      },
    ]);
    renderWidget({ ...BASE_WIDGET, metric: 'top_products', title: 'Top', chart_type: 'bar' });

    expect(await screen.findByTestId('top-products-chart')).toBeInTheDocument();
  });

  it('calls onRemove when the remove button is tapped', async () => {
    stubWidgetData({ stock_value: '0.000000' });
    const onRemove = vi.fn();
    renderWidget(BASE_WIDGET, { onRemove });

    await userEvent.click(
      await screen.findByRole('button', { name: /quitar valor de inventario/i }),
    );

    expect(onRemove).toHaveBeenCalled();
  });

  it('disables the remove button while removing', async () => {
    stubWidgetData({ stock_value: '0.000000' });
    renderWidget(BASE_WIDGET, { isRemoving: true });

    expect(
      await screen.findByRole('button', { name: /quitar valor de inventario/i }),
    ).toBeDisabled();
  });
});
