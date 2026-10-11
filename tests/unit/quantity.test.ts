import { describe, expect, it } from 'vitest';
import {
  compareQuantity,
  isOnStep,
  QUANTITY_SCALE,
  QuantityError,
  quantitiesEqual,
  quantityStepToGrid,
  snapQuantity,
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

describe('QUANTITY_SCALE', () => {
  // A quantity of 0.4 and 0.6 grid units at 10_000_000 minor per unit: only a
  // 1e6 grid rounds the first to 0 minor and the second to exactly 10.
  it('equals the quantity grid extendedAmount uses', () => {
    const rate = unitCostRate(10_000_000, 'BDT');
    expect(Number(extendedAmount(rate, 0.4 / QUANTITY_SCALE))).toBe(0);
    expect(Number(extendedAmount(rate, 0.6 / QUANTITY_SCALE))).toBe(10);
  });
});
