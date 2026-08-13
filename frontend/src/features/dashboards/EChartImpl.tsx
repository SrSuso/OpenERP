import * as echarts from 'echarts/core';
import { type ComposeOption } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import type { GridComponentOption, TooltipComponentOption } from 'echarts/components';

// The dashboards only render two Cartesian series. Keeping this registry
// explicit avoids adding unused chart types or renderers to the lazy chunk.
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export type EChartOption = ComposeOption<
  LineSeriesOption | BarSeriesOption | GridComponentOption | TooltipComponentOption
>;

interface EChartImplProps {
  option: EChartOption;
  height: number;
}

/** The imperative ECharts boundary: initialise, resize and dispose one canvas. */
export default function EChartImpl({ option, height }: EChartImplProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
