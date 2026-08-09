import { describe, expect, it } from 'vitest';

import { formatMoney, formatQuantity, formatRate } from './format';

describe('formatMoney', () => {
  it('renders a NUMERIC(18,6) string as two-decimal euros', () => {
    expect(formatMoney('36.300000')).toBe('36,30 €');
  });

  it('always shows exactly two decimals, even for whole amounts', () => {
    expect(formatMoney('5.000000')).toBe('5,00 €');
  });

  it('formats negative amounts (e.g. a discount)', () => {
    expect(formatMoney('-2.500000')).toBe('-2,50 €');
  });
});

describe('formatQuantity', () => {
  it('drops trailing zeros beyond what is meaningful', () => {
    expect(formatQuantity('1.000000')).toBe('1');
  });

  it('keeps up to three decimals for fractional quantities', () => {
    expect(formatQuantity('0.500000')).toBe('0,5');
  });

  it('rounds beyond three decimals', () => {
    expect(formatQuantity('1.234567')).toBe('1,235');
  });
});

describe('formatRate', () => {
  it('drops the NUMERIC(18,6) trailing zeros — 21 means 21%, not 0.21', () => {
    expect(formatRate('21.000000')).toBe('21');
  });

  it('keeps meaningful decimals (e.g. recargo de equivalencia)', () => {
    expect(formatRate('5.200000')).toBe('5,2');
  });
});
