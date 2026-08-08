import * as echarts from 'echarts/core';
import { type ComposeOption } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import type { GridComponentOption, TooltipComponentOption } from 'echarts/components';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export type EChartOption = ComposeOption<
  LineSeriesOption | BarSeriesOption | GridComponentOption | TooltipComponentOption
>;

interface EChartProps {
  option: EChartOption;
  height?: number;
}

/**
 * Thin imperative wrapper: this project depends on `echarts` directly (no
 * React binding), so every chart widget goes through this one place that
 * inits/resizes/disposes the instance — mirrors the "one choke point"
 * pattern the backend uses for the ledger (`record_movement`) and payments
 * (`checkout`), just for a DOM side effect instead of a transaction.
 */
export function EChart({ option, height = 240 }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const instance = echarts.init(container);
    instanceRef.current = instance;

    const resizeObserver = new ResizeObserver(() => instance.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    instanceRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={containerRef} data-testid="echart" style={{ height }} className="w-full" />;
}
