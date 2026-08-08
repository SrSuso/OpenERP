import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  // Nothing reaches the network by default: a test that needs an API response
  // stubs `fetch` explicitly, and one that forgets fails loudly.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Unexpected network call in a unit test'))),
  );

  // jsdom has no layout engine, so it never implements ResizeObserver —
  // only `EChart` (dashboards, phase 16) needs it, to resize the chart
  // when its container does. A no-op stub is enough: jsdom containers are
  // always 0×0, so there is never a real resize to observe anyway.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
