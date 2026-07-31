/**
 * Pure proration arithmetic — the drift-free core the contract kernel composes.
 * The load-bearing guarantees: `consumed + remaining === amount` exactly, sign
 * symmetry (reversals net to zero), timezone-agnostic (instants in, numbers out),
 * and no commercial policy baked in.
 */
import { describe, expect, it } from 'vitest';
import type { Money } from '../../src/money/money.js';
import {
  ProrationError,
  allocateMoneyByFraction,
  periodProgress,
  splitByPeriodFraction,
} from '../../src/money/proration.js';

const d = (iso: string): Date => new Date(iso);
const money = (amount: number, currency = 'BDT'): Money => ({ amount, currency });

describe('periodProgress', () => {
  it('whole_day: half-way through a 30-day period', () => {
    const f = periodProgress({
      periodStart: d('2026-01-01T00:00:00Z'),
      periodEnd: d('2026-01-31T00:00:00Z'), // 30 days
      asOf: d('2026-01-16T00:00:00Z'), // 15 days in
    });
    expect(f.periodDays).toBe(30);
    expect(f.elapsedDays).toBe(15);
    expect(f.remainingDays).toBe(15);
    expect(f.remainingFraction).toBeCloseTo(0.5, 10);
  });

  it('clamps asOf before start (full remaining) and after end (nothing remaining)', () => {
    const base = { periodStart: d('2026-01-01T00:00:00Z'), periodEnd: d('2026-01-31T00:00:00Z') };
    expect(periodProgress({ ...base, asOf: d('2025-12-01T00:00:00Z') }).remainingDays).toBe(30);
    expect(periodProgress({ ...base, asOf: d('2026-03-01T00:00:00Z') }).remainingDays).toBe(0);
  });

  it('exact: fractional day count', () => {
    const f = periodProgress({
      periodStart: d('2026-01-01T00:00:00Z'),
      periodEnd: d('2026-01-03T00:00:00Z'), // 2 days
      asOf: d('2026-01-02T12:00:00Z'), // 1.5 days in
      granularity: 'exact',
    });
    expect(f.periodDays).toBe(2);
    expect(f.elapsedDays).toBeCloseTo(1.5, 10);
    expect(f.remainingFraction).toBeCloseTo(0.25, 10);
  });

  it('rejects an inverted or zero-length period', () => {
    expect(() =>
      periodProgress({
        periodStart: d('2026-01-31T00:00:00Z'),
        periodEnd: d('2026-01-01T00:00:00Z'),
        asOf: d('2026-01-15T00:00:00Z'),
      }),
    ).toThrow(ProrationError);
  });
});

describe('splitByPeriodFraction', () => {
  it('splits drift-free: consumed + remaining === amount (odd amount)', () => {
    const f = periodProgress({
      periodStart: d('2026-01-01T00:00:00Z'),
      periodEnd: d('2026-01-08T00:00:00Z'), // 7 days
      asOf: d('2026-01-04T00:00:00Z'), // 3 days in
    });
    const { consumed, remaining } = splitByPeriodFraction(money(10_001), f); // not divisible by 7
    expect(consumed.amount + remaining.amount).toBe(10_001); // exact, no lost paisa
    expect(consumed.currency).toBe('BDT');
    expect(remaining.currency).toBe('BDT');
  });

  it('sign-symmetric: a reversal (negative amount) still nets exactly', () => {
    const f = periodProgress({
      periodStart: d('2026-01-01T00:00:00Z'),
      periodEnd: d('2026-01-31T00:00:00Z'),
      asOf: d('2026-01-16T00:00:00Z'),
    });
    const { consumed, remaining } = splitByPeriodFraction(money(-9_999), f);
    expect(consumed.amount + remaining.amount).toBe(-9_999);
  });

  it('boundary: nothing elapsed → all remaining; fully elapsed → all consumed', () => {
    const base = { periodStart: d('2026-01-01T00:00:00Z'), periodEnd: d('2026-01-31T00:00:00Z') };
    const atStart = splitByPeriodFraction(money(5_000), periodProgress({ ...base, asOf: base.periodStart }));
    expect(atStart.remaining.amount).toBe(5_000);
    expect(atStart.consumed.amount).toBe(0);
    const atEnd = splitByPeriodFraction(money(5_000), periodProgress({ ...base, asOf: base.periodEnd }));
    expect(atEnd.consumed.amount).toBe(5_000);
    expect(atEnd.remaining.amount).toBe(0);
  });
});

describe('allocateMoneyByFraction', () => {
  it('allocates the fraction-weighted part, drift-free against the whole', () => {
    expect(allocateMoneyByFraction(money(10_000), 0.5).amount).toBe(5_000);
    expect(allocateMoneyByFraction(money(10_001), 0).amount).toBe(0);
    expect(allocateMoneyByFraction(money(10_001), 1).amount).toBe(10_001);
  });

  it('rejects a fraction outside [0, 1]', () => {
    expect(() => allocateMoneyByFraction(money(100), 1.5)).toThrow(ProrationError);
    expect(() => allocateMoneyByFraction(money(100), -0.1)).toThrow(ProrationError);
  });
});
