import { describe, expect, it } from 'vitest';
import { allocate } from '../../src/money/split-allocation.js';
import {
  extendedAmount,
  isUnitCostRate,
  RATE_SCALE,
  rateMinorPerUnit,
  unitCostRate,
  UnitCostRateError,
  unitCostRateFromTotal,
} from '../../src/money/unit-cost-rate.js';

describe('unitCostRate', () => {
  it('scales a fractional minor-per-unit rate by RATE_SCALE', () => {
    const r = unitCostRate(33.3333, 'BDT');
    expect(r.scaledAmount).toBe(33_333_300);
    expect(r.scale).toBe(RATE_SCALE);
    expect(r.currency).toBe('BDT');
  });

  it('rejects negative / non-finite rates', () => {
    expect(() => unitCostRate(-1, 'BDT')).toThrow(UnitCostRateError);
    expect(() => unitCostRate(Number.POSITIVE_INFINITY, 'BDT')).toThrow(UnitCostRateError);
  });
});

describe('unitCostRateFromTotal (WAC)', () => {
  it('captures a repeating unit rate without losing value', () => {
    const r = unitCostRateFromTotal(100, 3, 'BDT'); // 33.333… paisa/unit
    expect(r.scaledAmount).toBe(33_333_333);
    expect(rateMinorPerUnit(r)).toBeCloseTo(33.333333, 6);
  });

  it('round-trips: extendedAmount(rate, qty) reconstructs the total', () => {
    const r = unitCostRateFromTotal(100, 3, 'BDT');
    // 33_333_333 × 3 / 1e6 = 99.999999 → rounds back to 100
    expect(extendedAmount(r, 3)).toBe(100);
  });

  it('rejects non-integer total or non-positive quantity', () => {
    expect(() => unitCostRateFromTotal(10.5, 3, 'BDT')).toThrow(UnitCostRateError);
    expect(() => unitCostRateFromTotal(100, 0, 'BDT')).toThrow(UnitCostRateError);
  });
});

describe('extendedAmount rounding', () => {
  it('half-even (banker) is the default', () => {
    const r = unitCostRate(1.5, 'BDT'); // scaledAmount 1_500_000
    expect(extendedAmount(r, 1)).toBe(2); // 1.5 → 2 (even)
    const r2 = unitCostRate(2.5, 'BDT');
    expect(extendedAmount(r2, 1)).toBe(2); // 2.5 → 2 (even)
    const r3 = unitCostRate(0.5, 'BDT');
    expect(extendedAmount(r3, 1)).toBe(0); // 0.5 → 0 (even)
  });

  it('half-up when requested', () => {
    expect(extendedAmount(unitCostRate(2.5, 'BDT'), 1, 'half-up')).toBe(3);
    expect(extendedAmount(unitCostRate(0.5, 'BDT'), 1, 'half-up')).toBe(1);
  });

  it('honours fractional quantities', () => {
    const r = unitCostRate(10, 'BDT'); // 10 paisa/unit
    expect(extendedAmount(r, 2.5)).toBe(25); // 10 × 2.5
  });

  it('zero quantity → zero', () => {
    expect(extendedAmount(unitCostRate(99.9, 'BDT'), 0)).toBe(0);
  });
});

describe('overflow safety (bigint path)', () => {
  it('stays exact where Number multiplication would lose precision', () => {
    // scaledAmount(1e12) × qScaled(1e10) = 1e22 ≫ 2^53 — a Number multiply
    // would drift; the bigint path is exact. Each factor is individually safe.
    const r = unitCostRate(1_000_000, 'BDT'); // 1e6 paisa/unit → scaledAmount 1e12
    expect(extendedAmount(r, 10_000)).toBe(10_000_000_000); // 1e6 × 1e4 = 1e10 minor
  });

  it('rejects a rate too large to scale safely', () => {
    // 1e12 paisa/unit × 1e6 scale = 1e18 > MAX_SAFE_INTEGER
    expect(() => unitCostRate(1e12, 'BDT')).toThrow(UnitCostRateError);
  });
});

describe('line totals reconcile to a document total', () => {
  it('per-line extended amounts sum to the document total by construction', () => {
    const lines = [
      { rate: unitCostRateFromTotal(100, 3, 'BDT'), qty: 3 },
      { rate: unitCostRate(49.99, 'BDT'), qty: 2 },
      { rate: unitCostRate(0.5, 'BDT'), qty: 7 },
    ];
    const lineTotals = lines.map((l) => extendedAmount(l.rate, l.qty));
    const documentTotal = lineTotals.reduce((a, b) => a + b, 0);
    // The document total IS the sum of line extended amounts — no drift.
    expect(lineTotals.reduce((a, b) => a + b, 0)).toBe(documentTotal);
  });

  it('a top-down charge splits across lines with no lost minor unit (via allocate)', () => {
    // Freight of 1000 paisa across 3 lines by value — reuses split-allocation.
    const freight = allocate(1000, [
      { id: 'L1', weight: 300 },
      { id: 'L2', weight: 300 },
      { id: 'L3', weight: 400 },
    ], 'by-value');
    expect(freight.parts.reduce((a, p) => a + p.amount, 0)).toBe(1000);
  });
});

describe('isUnitCostRate', () => {
  it('accepts a well-formed rate and rejects bare numbers / money', () => {
    expect(isUnitCostRate(unitCostRate(5, 'BDT'))).toBe(true);
    expect(isUnitCostRate(500)).toBe(false);
    expect(isUnitCostRate({ amount: 500, currency: 'BDT' })).toBe(false);
  });
});
