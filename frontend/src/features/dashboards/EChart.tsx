import { lazy, Suspense } from 'react';

import type { EChartOption } from './EChartImpl';
import { EChartLoadErrorBoundary } from './EChartLoadErrorBoundary';

export type { EChartOption } from './EChartImpl';

interface EChartProps {
  option: EChartOption;
  height?: number;
}

const STALE_CHUNK_RELOAD_KEY = 'openerp:stale-chunk-reload-at';
const STALE_CHUNK_RELOAD_WINDOW_MS = 30_000;

/**
 * Vite fingerprints lazy chunks. A tab left open during a deploy still has
 * the old entry module in memory and can therefore request a chunk that no
 * longer exists in the new web image. Reload exactly once to obtain the fresh
 * non-cacheable index; a second failure is shown by the local error boundary.
 */
function reloadAfterStaleChunkFailure(): boolean {
  try {
    const previousAttempt = Number(window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY));
    const now = Date.now();
    if (Number.isFinite(previousAttempt) && now - previousAttempt < STALE_CHUNK_RELOAD_WINDOW_MS) {
      return false;
    }
    window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(now));
    window.location.reload();
    return true;
  } catch {
    // Storage can be unavailable in a hardened browser context. The boundary
    // below still gives the operator a safe, explicit refresh action.
    return false;
  }
}

const EChartImpl = lazy(async () => {
  try {
    return await import('./EChartImpl');
  } catch (error) {
    if (reloadAfterStaleChunkFailure()) {
      // Navigation replaces this document. Keep React suspended until then so
      // the rejected import cannot escape to React Router's default boundary.
      return new Promise<never>(() => undefined);
    }
    throw error;
  }
});

/**
 * Dashboard shells and empty states do not need charting code. Load the
 * ECharts implementation only for a Line or Bar widget, keeping the same
 * sized, identifiable container while its chunk is fetched.
 */
export function EChart({ option, height = 240 }: EChartProps) {
  return (
    <EChartLoadErrorBoundary height={height}>
      <Suspense
        fallback={
          <div data-testid="echart" style={{ height }} className="w-full" aria-busy="true" />
        }
      >
        <EChartImpl option={option} height={height} />
      </Suspense>
    </EChartLoadErrorBoundary>
  );
}
