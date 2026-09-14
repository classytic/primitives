/**
 * Monetization — the canonical cross-kernel contract.
 *
 * The load-bearing cases are the reconciliation ones: catalog says `one_time`,
 * revenue says `purchase`, and for years nothing equated them. The round-trip
 * and the "everything-not-free-or-subscription is a purchase" rule are what let
 * a catalog classification survive into revenue's ledger vocabulary.
 */
import { describe, expect, it } from 'vitest';
import {
  compareAtPriceOf,
  defaultPassOf,
  fromRevenueMonetizationType,
  isBundleMonetization,
  isFreeMonetization,
  isMonetizationKind,
  isOneTimeMonetization,
  isPassMonetization,
  isSubscriptionMonetization,
  isUsageMonetization,
  MONETIZATION_KINDS,
  type Monetization,
  type MonetizationKind,
  monetizationKindOf,
  type RevenueMonetizationType,
  toRevenueMonetizationType,
  unitPriceOf,
} from '../../src/money/monetization.js';

describe('MonetizationKind', () => {
  it('lists the six canonical kinds and guards them', () => {
    expect([...MONETIZATION_KINDS]).toEqual([
      'free',
      'one_time',
      'subscription',
      'bundle',
      'usage',
      'pass',
    ]);
    for (const k of MONETIZATION_KINDS) expect(isMonetizationKind(k)).toBe(true);
    expect(isMonetizationKind('purchase')).toBe(false); // revenue's wire name is NOT a kind
    expect(isMonetizationKind(undefined)).toBe(false);
  });
});

describe('discriminated union guards', () => {
  const samples: Record<MonetizationKind, Monetization> = {
    free: { type: 'free' },
    one_time: {
      type: 'one_time',
      pricing: { basePrice: { amount: 12000, currency: 'BDT' }, currency: 'BDT' },
    },
    subscription: {
      type: 'subscription',
      plans: [
        {
          key: 'monthly',
          label: 'Monthly',
          price: { amount: 50000, currency: 'BDT' },
          duration: 1,
          durationUnit: 'month',
        },
      ],
    },
    bundle: { type: 'bundle', pricingMode: 'dynamic', dynamicDiscountPercent: 10 },
    usage: {
      type: 'usage',
      rating: { scheme: 'per_unit', perUnit: { amount: 500, currency: 'BDT' }, unitLabel: 'visit' },
    },
    pass: {
      type: 'pass',
      passes: [
        {
          key: 'm1',
          label: '1 month',
          price: { amount: 50000, currency: 'BDT' },
          duration: 1,
          durationUnit: 'month',
        },
      ],
    },
  };

  it('narrows each kind and reports it via monetizationKindOf', () => {
    expect(isFreeMonetization(samples.free)).toBe(true);
    expect(isOneTimeMonetization(samples.one_time)).toBe(true);
    expect(isSubscriptionMonetization(samples.subscription)).toBe(true);
    expect(isBundleMonetization(samples.bundle)).toBe(true);
    expect(isUsageMonetization(samples.usage)).toBe(true);
    expect(isPassMonetization(samples.pass)).toBe(true);
    for (const [kind, m] of Object.entries(samples)) {
      expect(monetizationKindOf(m)).toBe(kind);
    }
  });
});

describe('price resolution', () => {
  const money = (amount: number) => ({ amount, currency: 'BDT' });

  it('picks the headline unit price per kind', () => {
    expect(unitPriceOf({ type: 'free' })).toBeNull();
    expect(
      unitPriceOf({ type: 'one_time', pricing: { basePrice: money(12000), currency: 'BDT' } }),
    ).toEqual(money(12000));
    expect(
      unitPriceOf({
        type: 'subscription',
        plans: [
          { key: 'm', label: 'M', price: money(50000), duration: 1, durationUnit: 'month' },
          { key: 'y', label: 'Y', price: money(500000), duration: 1, durationUnit: 'year' },
        ],
      }),
    ).toEqual(money(50000)); // the FIRST plan, deterministically
    expect(unitPriceOf({ type: 'bundle', pricingMode: 'fixed', basePrice: money(9900) })).toEqual(
      money(9900),
    );
    expect(
      unitPriceOf({ type: 'bundle', pricingMode: 'dynamic', dynamicDiscountPercent: 10 }),
    ).toBeNull();
    expect(
      unitPriceOf({ type: 'usage', rating: { scheme: 'per_unit', perUnit: money(500) } }),
    ).toBeNull();
    // A pass leads with the CHEAPEST term, whatever order it was authored in.
    expect(
      unitPriceOf({
        type: 'pass',
        passes: [
          { key: 'y', label: '1 year', price: money(200000), duration: 1, durationUnit: 'year' },
          { key: 'm', label: '1 month', price: money(50000), duration: 1, durationUnit: 'month' },
        ],
      }),
    ).toEqual(money(50000));
    expect(unitPriceOf({ type: 'pass', passes: [] })).toBeNull();
  });

  it('breaks a price tie on the shorter term, so the headline is deterministic', () => {
    const passes = [
      {
        key: 'y',
        label: '1 year',
        price: money(50000),
        duration: 1,
        durationUnit: 'year' as const,
      },
      {
        key: 'm',
        label: '1 month',
        price: money(50000),
        duration: 1,
        durationUnit: 'month' as const,
      },
    ];
    expect(defaultPassOf({ type: 'pass', passes })?.key).toBe('m');
    expect(defaultPassOf({ type: 'pass', passes: [...passes].reverse() })?.key).toBe('m');
  });

  it('pairs a pass compareAt with the term the headline price came from', () => {
    const m: Monetization = {
      type: 'pass',
      passes: [
        {
          key: 'y',
          label: '1 year',
          price: money(200000),
          compareAtPrice: money(300000),
          duration: 1,
          durationUnit: 'year',
        },
        {
          key: 'm',
          label: '1 month',
          price: money(50000),
          compareAtPrice: money(60000),
          duration: 1,
          durationUnit: 'month',
        },
      ],
    };
    // The cheapest term is the headline, so its "was" is the one struck through.
    expect(unitPriceOf(m)).toEqual(money(50000));
    expect(compareAtPriceOf(m)).toEqual(money(60000));
  });

  it('exposes compareAt only for the kinds that carry one', () => {
    expect(
      compareAtPriceOf({
        type: 'one_time',
        pricing: { basePrice: money(12000), currency: 'BDT', compareAtPrice: money(15000) },
      }),
    ).toEqual(money(15000));
    expect(compareAtPriceOf({ type: 'free' })).toBeNull();
    expect(
      compareAtPriceOf({
        type: 'subscription',
        plans: [{ key: 'm', label: 'M', price: money(1), duration: 1, durationUnit: 'month' }],
      }),
    ).toBeNull();
  });
});

describe('revenue reconciliation', () => {
  it('maps purchase ↔ one_time and passes free/subscription through', () => {
    expect(fromRevenueMonetizationType('purchase')).toBe('one_time');
    expect(fromRevenueMonetizationType('subscription')).toBe('subscription');
    expect(fromRevenueMonetizationType('free')).toBe('free');
  });

  it('collapses one_time / bundle / usage / pass to a purchase in revenue vocabulary', () => {
    expect(toRevenueMonetizationType('one_time')).toBe('purchase');
    expect(toRevenueMonetizationType('bundle')).toBe('purchase');
    expect(toRevenueMonetizationType('usage')).toBe('purchase');
    // A pass never renews: settling it as a subscription would forecast
    // revenue nothing is scheduled to bill.
    expect(toRevenueMonetizationType('pass')).toBe('purchase');
    expect(toRevenueMonetizationType('subscription')).toBe('subscription');
    expect(toRevenueMonetizationType('free')).toBe('free');
  });

  it('round-trips the revenue wire types losslessly', () => {
    const wire: RevenueMonetizationType[] = ['free', 'purchase', 'subscription'];
    for (const t of wire) {
      expect(toRevenueMonetizationType(fromRevenueMonetizationType(t))).toBe(t);
    }
  });
});
