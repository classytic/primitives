import { describe, expect, it } from 'vitest';
import {
  addQuantity,
  compareQuantity,
  isOnStep,
  isOnStepStrict,
  isQuantityStep,
  QUANTITY_SCALE,
  QuantityError,
  quantitiesEqual,
  quantityStepToGrid,
  snapQuantity,
  subtractQuantity,
} from '../../src/inventory/quantity.js';
import { extendedAmount, unitCostRate } from '../../src/money/unit-cost-rate.js';

describe('snapQuantity', () => {
  it('removes float drift from a running balance', () => {
    const drifted = 10 - 2.35 - 2.35;
    expect(drifted).not.toBe(5.3);
    expect(snapQuantity(drifted, 0.001)).toBe(5.3);
    expect(snapQuantity(drifted)).toBe(5.3);
  });

  it('rounds to the unit step half-even at an exact tie', () => {
    expect(snapQuantity(2.3505, 0.001)).toBe(2.35);
    expect(snapQuantity(2.3515, 0.001)).toBe(2.352);
    expect(snapQuantity(2.3506, 0.001)).toBe(2.351);
    expect(snapQuantity(2.5, 1)).toBe(2);
    expect(snapQuantity(3.5, 1)).toBe(4);
    expect(snapQuantity(2.5, 1, 'half-up')).toBe(3);
  });

  it('is sign-symmetric for a negative adjustment', () => {
    expect(snapQuantity(-2.3505, 0.001)).toBe(-2.35);
    expect(snapQuantity(-2.3515, 0.001)).toBe(-2.352);
    expect(snapQuantity(-0.0000001, 0.001)).toBe(0);
    expect(Object.is(snapQuantity(-0.0000001, 0.001), -0)).toBe(false);
  });

  it('snaps to a non-decimal step', () => {
    expect(snapQuantity(7.3, 0.25)).toBe(7.25);
    expect(snapQuantity(7.4, 0.25)).toBe(7.5);
    expect(snapQuantity(13, 6)).toBe(12);
  });

  it('snaps to the 6-dp grid when no step is given', () => {
    expect(snapQuantity(1.23456789)).toBe(1.234568);
    expect(snapQuantity(0.1 + 0.2)).toBe(0.3);
  });

  it('refuses NaN, infinities and an invalid step', () => {
    expect(() => snapQuantity(Number.NaN, 0.001)).toThrowError(QuantityError);
    expect(() => snapQuantity(Number.POSITIVE_INFINITY)).toThrowError(/finite/);
    expect(() => snapQuantity(1, 0)).toThrowError(/positive/);
    expect(() => snapQuantity(1, -0.001)).toThrowError(/positive/);
    expect(() => snapQuantity(1, Number.NaN)).toThrowError(/positive/);
    expect(() => snapQuantity(1, 1e-7)).toThrowError(/multiple of 1\/1000000/);
    expect(() => snapQuantity(1, 1 / 3)).toThrowError(/multiple of 1\/1000000/);
    expect(() => snapQuantity(1e12, 1)).toThrowError(/precise grid range/);
  });
});

describe('isOnStep / compareQuantity', () => {
  it('accepts a multiple of the step and refuses one off it', () => {
    expect(isOnStep(2.35, 0.001)).toBe(true);
    expect(isOnStep(10 - 2.35 - 2.35, 0.001)).toBe(true);
    expect(isOnStep(2.3504, 0.001)).toBe(false);
    expect(isOnStep(0.5, 0.25)).toBe(true);
    expect(isOnStep(0.005, 0.001)).toBe(true);
    expect(isOnStep(2.5, 1)).toBe(false);
  });

  it('checks one step against a coarser rounding (catalog quantityStep vs base rounding)', () => {
    expect(isOnStep(0.25, 0.001)).toBe(true);
    expect(isOnStep(0.0005, 0.001)).toBe(false);
  });

  it('compares within half a grid unit', () => {
    expect(quantitiesEqual(5.300000000000001, 5.3)).toBe(true);
    expect(quantitiesEqual(5.300001, 5.3)).toBe(false);
    expect(compareQuantity(2.35, 2.351)).toBe(-1);
    expect(compareQuantity(2.351, 2.35)).toBe(1);
  });

  it('returns the step in grid units', () => {
    expect(quantityStepToGrid(0.001)).toBe(1000n);
    expect(quantityStepToGrid(1)).toBe(1_000_000n);
  });
});

describe('isQuantityStep', () => {
  const candidates: unknown[] = [
    1, 0.05, 0.001, 0.000001, 0.0000001, 0, -1, 0.5, 2.5, 1e-9, Number.NaN, Number.POSITIVE_INFINITY,
    '1', null, undefined, {}, 0.1 + 0.2, 1e12 + 0.5,
  ];

  it('is true exactly when quantityStepToGrid accepts the step', () => {
    for (const step of candidates) {
      let accepted = true;
      try {
        quantityStepToGrid(step as number);
      } catch {
        accepted = false;
      }
      expect(isQuantityStep(step), `step ${String(step)}`).toBe(accepted);
    }
  });

  it('refuses what is not a usable step and never throws', () => {
    for (const bad of [0, -1, 0.0000001, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined, {}]) {
      expect(isQuantityStep(bad)).toBe(false);
    }
    for (const good of [1, 0.05, 0.000001, 2.5]) expect(isQuantityStep(good)).toBe(true);
  });
});

describe('isOnStepStrict', () => {
  it('accepts an on-grid multiple of a valid step', () => {
    expect(isOnStepStrict(2.35, 0.05)).toBe(true);
    expect(isOnStepStrict(1.5, 0.5)).toBe(true);
    expect(isOnStepStrict(3, 1)).toBe(true);
  });

  it('refuses a quantity off the step', () => {
    expect(isOnStepStrict(2.33, 0.05)).toBe(false);
    expect(isOnStepStrict(1.5, 1)).toBe(false);
  });

  it('does not snap: a 7th decimal is off the grid, where isOnStep accepts it', () => {
    expect(isOnStep(2.3500004, 0.001)).toBe(true);
    expect(isOnStepStrict(2.3500004, 0.001)).toBe(false);
  });

  it('is total: junk answers false and never throws', () => {
    for (const q of [Number.NaN, Number.POSITIVE_INFINITY, -Number.POSITIVE_INFINITY, 1e300]) {
      expect(isOnStepStrict(q, 1)).toBe(false);
    }
    for (const step of [0, -1, 0.0000001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isOnStepStrict(1, step)).toBe(false);
    }
  });
});

describe('addQuantity / subtractQuantity', () => {
  it('sums on the grid, so a running total never drifts', () => {
    expect(1.2 + 1.15).not.toBe(2.35);
    expect(addQuantity(1.2, 1.15)).toBe(2.35);
    expect(addQuantity(0.1, 0.2)).toBe(0.3);
  });

  it('subtracts on the grid', () => {
    expect(10 - 2.35 - 2.35).not.toBe(5.3);
    expect(subtractQuantity(subtractQuantity(10, 2.35), 2.35)).toBe(5.3);
  });

  it('returns 0, never -0', () => {
    expect(Object.is(subtractQuantity(1.5, 1.5), 0)).toBe(true);
    expect(Object.is(addQuantity(-0.5, 0.5), 0)).toBe(true);
  });

  it('refuses a non-finite operand like the rest of the grid', () => {
    expect(() => addQuantity(Number.NaN, 1)).toThrow(QuantityError);
    expect(() => subtractQuantity(1, Number.POSITIVE_INFINITY)).toThrow(QuantityError);
  });
});

describe('QUANTITY_SCALE', () => {
  // A quantity of 0.4 and 0.6 grid units at 10_000_000 minor per unit: only a
  // 1e6 grid rounds the first to 0 minor and the second to exactly 10.
  it('equals the quantity grid extendedAmount uses', () => {
    const rate = unitCostRate(10_000_000, 'BDT');
    expect(Number(extendedAmount(rate, 0.4 / QUANTITY_SCALE))).toBe(0);
    expect(Number(extendedAmount(rate, 0.6 / QUANTITY_SCALE))).toBe(10);
  });
});
