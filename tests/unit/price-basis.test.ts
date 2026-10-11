import { describe, expect, it } from 'vitest';
import {
  fixedPriceBasis,
  isPriceBasis,
  measuredPriceBasis,
  type PriceBasis,
  PriceBasisError,
  resolvePriceBasisTotal,
} from '../../src/money/price-basis.js';
import { roundedDiv } from '../../src/money/rounded-div.js';

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

  it('refuses a non-positive per-price-unit quantity', () => {
    expect(() => measuredPriceBasis('duration', 'minute', 'hour', 0)).toThrowError(
      /quantityPerPriceUnit must be a positive safe integer/,
    );
  });

  it('keeps every whole-quantity result exactly as before, across the full safe range', () => {
    const hourly = measuredPriceBasis('duration', 'minute', 'hour', 60);
    const perKg = measuredPriceBasis('mass', 'gram', 'kilogram', 1_000);
    // The pre-0.31 formula, verbatim: integer quantity, one half-even division.
    const legacy = (price: number, qty: number, per: number) =>
      Number(roundedDiv(BigInt(price) * BigInt(qty), BigInt(per), 'half-even'));
    const cases: Array<[number, number, number, PriceBasis]> = [
      [2_500, 3, 1, fixedPriceBasis()],
      [0, 7, 1, fixedPriceBasis()],
      [9_999, 0, 1, fixedPriceBasis()],
      [1, 1_000_000_000_000, 1, fixedPriceBasis()],
      [3, 30, 60, hourly],
      [1, 30, 60, hourly],
      [7_500, 90, 60, hourly],
      [25_000, 750, 1_000, perKg],
      [12_345, 4_567_890_123, 1_000, perKg],
    ];
    for (const [price, qty, per, basis] of cases) {
      expect(resolvePriceBasisTotal(price, qty, basis), `${price} x ${qty} / ${per}`).toBe(
        legacy(price, qty, per),
      );
    }
  });

  it('prices a fractional quantity exactly on the 6-dp grid, rounding once half-even', () => {
    expect(resolvePriceBasisTotal(12_000, 2.35)).toBe(28_200);
    expect(resolvePriceBasisTotal(100, 0.125)).toBe(12);
    expect(resolvePriceBasisTotal(100, 0.375)).toBe(38);
    expect(resolvePriceBasisTotal(999, 1.237)).toBe(1_236);
    expect(resolvePriceBasisTotal(100, 1.015)).toBe(102);
    expect(
      resolvePriceBasisTotal(7_500, 1.5, measuredPriceBasis('duration', 'minute', 'hour', 60)),
    ).toBe(188);
    expect(
      resolvePriceBasisTotal(25_000, 750.5, measuredPriceBasis('mass', 'gram', 'kilogram', 1_000)),
    ).toBe(18_762);
  });

  it('refuses a negative, non-finite, off-grid or out-of-range quantity', () => {
    for (const bad of [
      -0.5,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e-7,
      2.3500004,
      1e12 + 0.5,
    ]) {
      expect(() => resolvePriceBasisTotal(100, bad), String(bad)).toThrowError(PriceBasisError);
    }
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
