import { describe, expect, it } from 'vitest';
import { isOnQuantityGrid, isOnStep } from '../../src/inventory/quantity.js';

describe('isOnQuantityGrid — strict, for input boundaries', () => {
  it('accepts grid values, including float drift of a grid value', () => {
    for (const v of [0, 1, 2.35, 0.000001, 10 - 2.35 - 2.35, 0.1 + 0.2, 123456.789012, -2.35]) {
      expect(isOnQuantityGrid(v)).toBe(true);
    }
  });

  it('refuses a 7th decimal that isOnStep would snap away', () => {
    expect(isOnStep(2.3500004, 0.001)).toBe(true);
    expect(isOnQuantityGrid(2.3500004)).toBe(false);
    expect(isOnQuantityGrid(1e-7)).toBe(false);
  });

  it('refuses non-finite and out-of-range values', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e12]) {
      expect(isOnQuantityGrid(v)).toBe(false);
    }
  });
});
