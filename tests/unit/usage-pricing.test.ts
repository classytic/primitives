/**
 * priceUsage — every scheme, included units, band edges, round-up, and every named refusal.
 * Amounts are integer minor units (BDT paisa): 6000 = 60 taka.
 */
import { describe, expect, it } from 'vitest';
import type { UsageRating } from '../../src/money/monetization.js';
import { type Money, money } from '../../src/money/money.js';
import { isUsageMeasure, priceUsage, UsagePricingError } from '../../src/money/usage-pricing.js';

const bdt = (amount: number): Money => money(amount, 'BDT');

/** "60 taka for the first kg, 20 taka per started kg after." */
const courier: UsageRating = {
  scheme: 'tiered',
  unitLabel: 'kg',
  tiers: [{ upTo: 1, flatPrice: bdt(6000) }, { perUnit: bdt(2000) }],
};

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof UsagePricingError ? err.code : `not-named:${String(err)}`;
  }
  return undefined;
};

describe('priceUsage — the courier rate card', () => {
  it.each([
    [0.4, 1, 6000],
    [1, 1, 6000],
    [1.01, 2, 8000],
    [2.3, 3, 10000],
    [5, 5, 14000],
  ])('%s kg bills %s kg = %s paisa', (kg, billable, amount) => {
    const charge = priceUsage(courier, kg);
    expect(charge.billableUnits).toBe(billable);
    expect(charge.amount).toEqual({ amount, currency: 'BDT' });
    expect(charge.unitLabel).toBe('kg');
  });

  it('breaks 2.3 kg into the flat first band and two per-kg units', () => {
    expect(priceUsage(courier, 2.3).lines).toEqual([
      { band: 0, quantity: 1, unitAmount: 0, flatAmount: 6000, amount: 6000 },
      { band: 1, quantity: 2, unitAmount: 2000, flatAmount: 0, amount: 4000 },
    ]);
  });

  it('snaps float noise before rounding up, so an exact unit is not billed twice', () => {
    // 2.2 - 1.2 === 1.0000000000000002 in IEEE 754.
    const perKg: UsageRating = { scheme: 'per_unit', perUnit: bdt(2000), includedUnits: 1.2 };
    expect(priceUsage(perKg, 2.2).billableUnits).toBe(1);
    expect(priceUsage(courier, 1.0000001).billableUnits).toBe(2);
  });
});

describe('priceUsage — per_unit', () => {
  const perSeat: UsageRating = { scheme: 'per_unit', perUnit: bdt(1500), unitLabel: 'seat' };

  it('multiplies whole units, rounding a started unit up', () => {
    expect(priceUsage(perSeat, 3).amount.amount).toBe(4500);
    expect(priceUsage(perSeat, 3.2).amount.amount).toBe(6000);
  });

  it('subtracts included units before metering', () => {
    const charge = priceUsage({ ...perSeat, includedUnits: 2 }, 5);
    expect(charge.billableUnits).toBe(3);
    expect(charge.amount.amount).toBe(4500);
  });

  it('charges nothing while usage stays inside the included units', () => {
    const charge = priceUsage({ ...perSeat, includedUnits: 5 }, 4.5);
    expect(charge.billableUnits).toBe(0);
    expect(charge.lines).toEqual([]);
    expect(charge.amount).toEqual({ amount: 0, currency: 'BDT' });
  });
});

describe('priceUsage — tiered (graduated) band edges', () => {
  const graduated: UsageRating = {
    scheme: 'tiered',
    tiers: [
      { upTo: 10, perUnit: bdt(100) },
      { upTo: 20, perUnit: bdt(80), flatPrice: bdt(500) },
      { perUnit: bdt(50) },
    ],
  };

  it.each([
    [10, 1000],
    [11, 1000 + 500 + 80],
    [20, 1000 + 500 + 800],
    [21, 1000 + 500 + 800 + 50],
  ])('%s units = %s', (units, amount) => {
    expect(priceUsage(graduated, units).amount.amount).toBe(amount);
  });

  it('refuses an amount past a bounded last band instead of quoting the last rate', () => {
    const capped: UsageRating = { scheme: 'tiered', tiers: [{ upTo: 30, perUnit: bdt(100) }] };
    expect(priceUsage(capped, 30).amount.amount).toBe(3000);
    expect(codeOf(() => priceUsage(capped, 30.5))).toBe('EXCEEDS_RATE_TABLE');
  });
});

describe('priceUsage — volume', () => {
  const vol: UsageRating = {
    scheme: 'volume',
    tiers: [
      { upTo: 10, perUnit: bdt(100) },
      { upTo: 20, perUnit: bdt(80), flatPrice: bdt(300) },
      { perUnit: bdt(50) },
    ],
  };

  it.each([
    [10, 0, 1000],
    [11, 1, 11 * 80 + 300],
    [20, 1, 20 * 80 + 300],
    [21, 2, 21 * 50],
  ])('%s units land in band %s = %s', (units, band, amount) => {
    const charge = priceUsage(vol, units);
    expect(charge.lines).toHaveLength(1);
    expect(charge.lines[0]?.band).toBe(band);
    expect(charge.amount.amount).toBe(amount);
  });

  it('refuses an amount past a bounded last band', () => {
    const capped: UsageRating = { scheme: 'volume', tiers: [{ upTo: 5, perUnit: bdt(100) }] };
    expect(codeOf(() => priceUsage(capped, 6))).toBe('EXCEEDS_RATE_TABLE');
  });
});

describe('priceUsage — package', () => {
  const sms: UsageRating = {
    scheme: 'package',
    packageSize: 100,
    packagePrice: bdt(25000),
    unitLabel: 'sms',
  };

  it('charges ceil(billable / packageSize) packages', () => {
    expect(priceUsage(sms, 100)).toMatchObject({
      billableUnits: 100,
      packages: 1,
      amount: { amount: 25000 },
    });
    expect(priceUsage(sms, 101)).toMatchObject({
      billableUnits: 101,
      packages: 2,
      amount: { amount: 50000 },
    });
    expect(priceUsage(sms, 250.5)).toMatchObject({
      billableUnits: 251,
      packages: 3,
      amount: { amount: 75000 },
    });
  });

  it('applies included units before packaging', () => {
    expect(priceUsage({ ...sms, includedUnits: 50 }, 150)).toMatchObject({
      billableUnits: 100,
      packages: 1,
    });
  });
});

describe('priceUsage — named refusals', () => {
  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])('refuses measured = %s', (bad) => {
    expect(codeOf(() => priceUsage(courier, bad))).toBe('INVALID_MEASURE');
  });

  it.each([
    ['per_unit without perUnit', { scheme: 'per_unit' }, 'MISSING_PER_UNIT'],
    ['tiered without tiers', { scheme: 'tiered' }, 'MISSING_TIERS'],
    ['volume with an empty table', { scheme: 'volume', tiers: [] }, 'MISSING_TIERS'],
    [
      'package without packageSize',
      { scheme: 'package', packagePrice: bdt(100) },
      'MISSING_PACKAGE',
    ],
    [
      'package with a fractional size',
      { scheme: 'package', packageSize: 2.5, packagePrice: bdt(100) },
      'MISSING_PACKAGE',
    ],
    ['package without packagePrice', { scheme: 'package', packageSize: 10 }, 'MISSING_PACKAGE'],
    [
      'a band with no rate',
      { scheme: 'tiered', tiers: [{ upTo: 1 }, { perUnit: bdt(1) }] },
      'INVALID_TIER',
    ],
    [
      'an open band before the last',
      { scheme: 'tiered', tiers: [{ perUnit: bdt(1) }, { perUnit: bdt(2) }] },
      'INVALID_TIER',
    ],
    [
      'bands out of order',
      {
        scheme: 'tiered',
        tiers: [{ upTo: 5, perUnit: bdt(1) }, { upTo: 3, perUnit: bdt(1) }, { perUnit: bdt(1) }],
      },
      'INVALID_TIER',
    ],
    [
      'mixed currencies',
      {
        scheme: 'tiered',
        tiers: [{ upTo: 1, flatPrice: bdt(6000) }, { perUnit: money(20, 'USD') }],
      },
      'CURRENCY_MISMATCH',
    ],
    [
      'a fractional rate',
      { scheme: 'per_unit', perUnit: { amount: 10.5, currency: 'BDT' } },
      'INVALID_MONEY',
    ],
    [
      'negative included units',
      { scheme: 'per_unit', perUnit: bdt(1), includedUnits: -1 },
      'INVALID_INCLUDED_UNITS',
    ],
    ['an unknown scheme', { scheme: 'per_minute', perUnit: bdt(1) }, 'UNKNOWN_SCHEME'],
  ])('refuses %s', (_label, rating, code) => {
    expect(codeOf(() => priceUsage(rating as UsageRating, 2))).toBe(code);
  });

  it('refuses a total past MAX_SAFE_INTEGER', () => {
    const huge: UsageRating = { scheme: 'per_unit', perUnit: bdt(Number.MAX_SAFE_INTEGER) };
    expect(codeOf(() => priceUsage(huge, 2))).toBe('UNSAFE_TOTAL');
  });
});

describe('isUsageMeasure', () => {
  it('accepts a positive finite value with a unit', () => {
    expect(isUsageMeasure({ value: 2.3, unit: 'kg' })).toBe(true);
  });
  it.each([
    [{ value: 0, unit: 'kg' }],
    [{ value: -1, unit: 'kg' }],
    [{ value: Number.NaN, unit: 'kg' }],
    [{ value: 2, unit: ' ' }],
    [{ value: '2', unit: 'kg' }],
    [null],
  ])('refuses %j', (value) => {
    expect(isUsageMeasure(value)).toBe(false);
  });
});
