import { describe, expect, it } from 'vitest';

import {
  businessDateAt,
  formatBusinessDate,
  formatBusinessDateTime,
  formatBusinessTime,
} from './businessTime';

const INSTANT = '2026-08-12T22:30:00Z';

describe('business time', () => {
  it('formats an absolute instant in the configured commercial timezone', () => {
    expect(formatBusinessDateTime(INSTANT, 'Europe/Madrid')).toBe('13/08/2026, 00:30');
    expect(formatBusinessDate(INSTANT, 'Europe/Madrid')).toBe('13/08/2026');
    expect(formatBusinessTime(INSTANT, 'Europe/Madrid')).toBe('00:30');
  });

  it('does not inherit the browser timezone', () => {
    expect(formatBusinessDateTime(INSTANT, 'Europe/Madrid')).toBe('13/08/2026, 00:30');
    expect(formatBusinessDateTime(INSTANT, 'UTC')).toBe('12/08/2026, 22:30');
  });

  it('keeps today as a YYYY-MM-DD business date', () => {
    const now = new Date(INSTANT);

    expect(businessDateAt('Europe/Madrid', now)).toBe('2026-08-13');
    expect(businessDateAt('UTC', now)).toBe('2026-08-12');
  });
});
