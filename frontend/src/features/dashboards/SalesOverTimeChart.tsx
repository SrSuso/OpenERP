import { EChart, type EChartOption } from '@/features/dashboards/EChart';
import { type SalesOverTimePoint } from '@/features/dashboards/api';
import { formatMoney } from '@/lib/format';

const BLUE = '#2a78d6';
const GRIDLINE = '#e1e0d9';
const MUTED = '#898781';
const PRIMARY_INK = '#0b0b0b';

interface SalesOverTimeChartProps {
  points: SalesOverTimePoint[];
}

/**
 * A single measure (daily revenue) over time — one series, so one
 * consistent hue and no legend (a legend box only earns its place at ≥ 2
 * series; the widget's own title already names this one).
 */
export function SalesOverTimeChart({ points }: SalesOverTimeChartProps) {
  const option: EChartOption = {
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: GRIDLINE } },
      valueFormatter: (value: unknown) => formatMoney(String(value)),
    },
    xAxis: {
      type: 'category',
      data: points.map((p) => p.date),
      axisLine: { lineStyle: { color: GRIDLINE } },
      axisTick: { show: false },
      axisLabel: { color: MUTED, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: GRIDLINE } },
      axisLabel: {
        color: MUTED,
        fontSize: 11,
        formatter: (value: number) => formatMoney(String(value)),
      },
    },
    series: [
      {
        type: 'line',
        data: points.map((p) => Number(p.total)),
        lineStyle: { color: BLUE, width: 2 },
        itemStyle: { color: BLUE },
        symbolSize: 8,
        smooth: false,
      },
    ],
    textStyle: { color: PRIMARY_INK, fontFamily: 'inherit' },
  };

  return <EChart option={option} />;
}
