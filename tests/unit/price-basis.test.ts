import { describe, expect, it } from 'vitest';
import {
  fixedPriceBasis,
  isPriceBasis,
  measuredPriceBasis,
  PriceBasisError,
  resolvePriceBasisTotal,
} from '../../src/money/price-basis.js';

describe('price basis', () => {
  it('keeps the ordinary fixed-price path as price times item count', () => {
    expect(resolvePriceBasisTotal(2_500, 3, fixedPriceBasis())).toBe(7_500);
    expect(resolvePriceBasisTotal(2_500, 3)).toBe(7_500);
  });

  it('prices integer grams against a kilogram rate', () => {
    const basis = measuredPriceBasis('mass', 'gram', 'kilogram', 1_000);
    expect(resolvePriceBasisTotal(25_000, 750, basis)).toBe(18_750);
  });

  it('prices integer minutes against an hourly rate', () => {
    const basis = measuredPriceBasis('duration', 'minute', 'hour', 60);
    expect(resolvePriceBasisTotal(7_500, 90, basis)).toBe(11_250);
  });

  it('uses half-even rounding at the minor-unit boundary', () => {
    const basis = measuredPriceBasis('duration', 'minute', 'hour', 60);
    expect(resolvePriceBasisTotal(1, 30, basis)).toBe(0);
    expect(resolvePriceBasisTotal(3, 30, basis)).toBe(2);
  });

  it('refuses unsafe or non-integer measured quantities', () => {
    const basis = measuredPriceBasis('duration', 'minute', 'hour', 60);
    expect(() => resolvePriceBasisTotal(7_500, 1.5, basis)).toThrowError(PriceBasisError);
    expect(() => measuredPriceBasis('duration', 'minute', 'hour', 0)).toThrowError(
      /quantityPerPriceUnit must be a positive safe integer/,
    );
  });

  it('guards persisted pricing-basis shapes', () => {
    expect(isPriceBasis({ kind: 'fixed' })).toBe(true);
    expect(
      isPriceBasis({
        kind: 'measured',
        dimension: 'duration',
        quantityUnit: 'minute',
        priceUnit: 'hour',
        quantityPerPriceUnit: 60,
      }),
    ).toBe(true);
    expect(isPriceBasis({ kind: 'measured', dimension: 'duration', quantityPerPriceUnit: 0 })).toBe(
      false,
    );
  });
});
