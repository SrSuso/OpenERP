import { describe, expect, it } from 'vitest';

import { columnLabel } from './columnLabels';

describe('columnLabel', () => {
  it('translates a known output column to its Spanish label', () => {
    expect(columnLabel('product_name')).toBe('Producto');
    expect(columnLabel('revenue')).toBe('Ingresos');
  });

  it('falls back to the raw key for an unknown column', () => {
    expect(columnLabel('something_new')).toBe('something_new');
  });
});
