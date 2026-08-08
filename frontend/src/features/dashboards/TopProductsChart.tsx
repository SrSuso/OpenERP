import { EChart, type EChartOption } from '@/features/dashboards/EChart';
import { type TopProductRow } from '@/features/dashboards/api';
import { formatMoney, formatQuantity } from '@/lib/format';

const BLUE = '#2a78d6';
const GRIDLINE = '#e1e0d9';
const MUTED = '#898781';
const PRIMARY_INK = '#0b0b0b';

interface TopProductsChartProps {
  rows: TopProductRow[];
  orderBy: 'revenue' | 'quantity';
}

/**
 * One measure (revenue or quantity) across products — the category axis
 * already carries identity, so every bar is the same hue; a rainbow per
 * bar would imply a distinction that isn't there. Horizontal so product
 * names stay readable without rotating labels.
 */
export function TopProductsChart({ rows, orderBy }: TopProductsChartProps) {
  // ECharts draws a horizontal bar chart bottom-to-top; reverse so the
  // biggest value (already first from the API's own ORDER BY) lands on top.
  const ordered = [...rows].reverse();
  const values = ordered.map((r) => Number(orderBy === 'revenue' ? r.revenue : r.quantity));
  const format = orderBy === 'revenue' ? formatMoney : formatQuantity;

  const option: EChartOption = {
    grid: { left: 140, right: 24, top: 8, bottom: 8 },
    tooltip: {
      trigger: 'item',
      valueFormatter: (value: unknown) => format(String(value)),
    },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: GRIDLINE } },
      axisLabel: {
        color: MUTED,
        fontSize: 11,
        formatter: (value: number) => format(String(value)),
      },
    },
    yAxis: {
      type: 'category',
      data: ordered.map((r) => r.product_name),
      axisLine: { lineStyle: { color: GRIDLINE } },
      axisTick: { show: false },
      axisLabel: { color: MUTED, fontSize: 11, width: 120, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: values,
        itemStyle: { color: BLUE, borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 24,
      },
    ],
    textStyle: { color: PRIMARY_INK, fontFamily: 'inherit' },
  };

  return <EChart option={option} height={Math.max(160, ordered.length * 36)} />;
}
