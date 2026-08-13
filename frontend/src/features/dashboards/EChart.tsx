import { lazy, Suspense } from 'react';

import type { EChartOption } from './EChartImpl';

export type { EChartOption } from './EChartImpl';

interface EChartProps {
  option: EChartOption;
  height?: number;
}

const EChartImpl = lazy(() => import('./EChartImpl'));

/**
 * Dashboard shells and empty states do not need charting code. Load the
 * ECharts implementation only for a Line or Bar widget, keeping the same
 * sized, identifiable container while its chunk is fetched.
 */
export function EChart({ option, height = 240 }: EChartProps) {
  return (
    <Suspense
      fallback={<div data-testid="echart" style={{ height }} className="w-full" aria-busy="true" />}
    >
      <EChartImpl option={option} height={height} />
    </Suspense>
  );
}
