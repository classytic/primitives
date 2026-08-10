/**
 * FALSIFYING tests for the "silent permissiveness" defects fixed in the
 * Unreleased section of CHANGELOG.md.
 *
 * Each case here is a scenario where the OLD code returned a plausible-looking
 * answer instead of an error. Every `expect(...).toThrow(...)` below FAILS
 * against the previous implementation — that is the point: these tests are the
 * enforcement, not the docblocks.
 */

import { describe, expect, it } from 'vitest';
import { isKnownCurrency, minorUnitFactor } from '../../src/money/currency.js';
import { fromMajor } from '../../src/money/money.js';
import {
  allocateMoneyByFraction,
  periodProgress,
  splitByPeriodFraction,
} from '../../src/money/proration.js';
import {
  DateRangeError,
  isDateRange,
  isWithin,
  rangeDurationMs,
  rangesOverlap,
} from '../../src/scheduling/period.js';
import { zoneOffsetMinutes } from '../../src/scheduling/timezone.js';
import {
  CanonicalizeError,
  canonicalDigest,
  canonicalJson,
} from '../../src/serialization/canonical.js';
import { assertAndClaim, defineStateMachine } from '../../src/workflow/state-machine.js';

// ─────────────────────────────────────────────────────────────────────────────
// period — an Invalid Date must not answer "no overlap"
// ─────────────────────────────────────────────────────────────────────────────

describe('period: a non-finite endpoint fails instead of reporting no-overlap', () => {
  const bad = { start: new Date('not-a-date'), end: new Date('2026-01-02') };
  const good = { start: new Date('2026-01-01'), end: new Date('2026-01-03') };

  it('rangesOverlap throws rather than returning false', () => {
    // OLD: every NaN comparison is false ⇒ `false` ⇒ "no conflict" ⇒ double-book.
    expect(() => rangesOverlap(bad, good)).toThrow(DateRangeError);
    expect(() => rangesOverlap(good, bad)).toThrow(DateRangeError);
  });

  it('a genuinely non-overlapping pair still returns false', () => {
    expect(
      rangesOverlap(good, { start: new Date('2026-02-01'), end: new Date('2026-02-02') }),
    ).toBe(false);
  });

  it('isWithin throws on an invalid instant or an invalid range', () => {
    expect(() => isWithin(new Date('nope'), good)).toThrow(DateRangeError);
    expect(() => isWithin(new Date('2026-01-02'), bad)).toThrow(DateRangeError);
  });

  it('rangeDurationMs throws rather than returning NaN', () => {
    expect(() => rangeDurationMs(bad)).toThrow(DateRangeError);
    expect(rangeDurationMs(good)).toBe(2 * 86_400_000);
  });

  it('isDateRange rejects Invalid Date endpoints', () => {
    expect(isDateRange(bad)).toBe(false);
    expect(isDateRange(good)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// currency — the ISO exponent table must cover every non-2-decimal currency
// ─────────────────────────────────────────────────────────────────────────────

describe('currency: no zero-/three-/four-decimal currency silently gets 2 decimals', () => {
  const ZERO = [
    'BIF',
    'CLP',
    'DJF',
    'GNF',
    'ISK',
    'JPY',
    'KMF',
    'KRW',
    'PYG',
    'RWF',
    'UGX',
    'UYI',
    'VND',
    'VUV',
    'XAF',
    'XOF',
    'XPF',
  ];
  const THREE = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
  const FOUR = ['CLF', 'UYW'];

  it.each(ZERO)('%s has exponent 0', (code) => {
    expect(minorUnitFactor(code)).toBe(1);
  });

  it.each(THREE)('%s has exponent 3', (code) => {
    expect(minorUnitFactor(code)).toBe(1000);
  });

  it.each(FOUR)('%s has exponent 4', (code) => {
    expect(minorUnitFactor(code)).toBe(10_000);
  });

  it('a zero-decimal amount is not inflated 100x', () => {
    // OLD (GNF absent from the table): 1500 major → 150_000 minor.
    expect(fromMajor(1500, 'GNF').amount).toBe(1500);
    expect(fromMajor(10, 'LYD').amount).toBe(10_000);
  });

  it('an ordinary two-decimal currency still defaults correctly', () => {
    expect(minorUnitFactor('BDT')).toBe(100);
    expect(minorUnitFactor('SEK')).toBe(100);
  });

  it('isKnownCurrency distinguishes "listed" from "assumed"', () => {
    expect(isKnownCurrency('JPY')).toBe(true);
    expect(isKnownCurrency('jpy')).toBe(false); // lowercase would silently get 100
    expect(isKnownCurrency('ZZZ')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// proration — a missing allocated part is not "zero money"
// ─────────────────────────────────────────────────────────────────────────────

describe('proration: split parts are required, never defaulted to 0', () => {
  const amount = { amount: 10_000, currency: 'BDT' };

  it('splitByPeriodFraction still reconciles exactly', () => {
    const fraction = periodProgress({
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T00:00:00Z'),
      asOf: new Date('2026-01-11T00:00:00Z'),
    });
    const { consumed, remaining } = splitByPeriodFraction(amount, fraction);
    expect(consumed.amount + remaining.amount).toBe(amount.amount);
    expect(consumed.currency).toBe('BDT');
  });

  it('a zero-length overlap does not silently produce a zero credit', () => {
    // Both weights zero is a broken fraction; the allocator must complain, not
    // hand back {consumed: 0, remaining: 0} for a non-zero amount.
    expect(() =>
      splitByPeriodFraction(amount, {
        periodDays: 0,
        elapsedDays: 0,
        remainingDays: 0,
        remainingFraction: 0,
      }),
    ).toThrow();
  });

  it('allocateMoneyByFraction reconciles at the boundaries', () => {
    expect(allocateMoneyByFraction(amount, 1).amount).toBe(10_000);
    expect(allocateMoneyByFraction(amount, 0).amount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state-machine — an empty source list must never reach the CAS
// ─────────────────────────────────────────────────────────────────────────────

describe('state-machine: assertAndClaim rejects an empty allow-list', () => {
  type S = 'draft' | 'approved' | 'shipped';
  const MACHINE = defineStateMachine<S>({
    name: 'Order',
    transitions: { draft: ['approved'], approved: ['shipped'], shipped: [] },
  });

  it('validSources of an unreachable status is empty', () => {
    expect(MACHINE.validSources('draft')).toEqual([]);
  });

  it('claim() is never called with an empty from-list', async () => {
    let called = false;
    const repo = {
      claim: async () => {
        called = true;
        return null;
      },
    };
    // OLD: the assert loop ran zero times and `claim({ from: [] })` was issued —
    // indistinguishable from a race-loss, and fail-OPEN on any kit that reads an
    // empty list as "unconstrained".
    await expect(
      assertAndClaim(MACHINE, repo, 'o1', { from: MACHINE.validSources('draft'), to: 'draft' }),
    ).rejects.toThrow(/Invalid transition/);
    expect(called).toBe(false);
  });

  it('a populated multi-source claim still works', async () => {
    const repo = { claim: async () => ({ id: 'o1' }) };
    await expect(
      assertAndClaim(MACHINE, repo, 'o1', { from: MACHINE.validSources('shipped'), to: 'shipped' }),
    ).resolves.toEqual({ id: 'o1' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// timezone — an unparseable offset label must not resolve to UTC
// ─────────────────────────────────────────────────────────────────────────────

describe('timezone: offset parsing is anchored', () => {
  it('resolves real zones', () => {
    const t = new Date('2026-07-01T12:00:00Z');
    expect(zoneOffsetMinutes(t, 'Asia/Dhaka')).toBe(360);
    expect(zoneOffsetMinutes(t, 'UTC')).toBe(0);
    expect(zoneOffsetMinutes(t, 'Asia/Kolkata')).toBe(330);
    expect(zoneOffsetMinutes(t, 'America/New_York')).toBe(-240);
  });

  it('an invalid zone throws rather than answering 0', () => {
    expect(() => zoneOffsetMinutes(new Date(), 'Not/AZone')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canonical — a class instance must not digest as {}
// ─────────────────────────────────────────────────────────────────────────────

describe('canonical: class instances are rejected, not collapsed', () => {
  class ObjectIdLike {
    // Mirrors a Mongo ObjectId: the identity lives in a non-enumerable buffer,
    // so Object.keys() sees nothing.
    constructor(private readonly hex: string) {
      Object.defineProperty(this, 'hex', { value: hex, enumerable: false });
    }
    override toString(): string {
      return this.hex;
    }
  }

  it('two different ids no longer produce the same digest', () => {
    const a = { ref: new ObjectIdLike('aaaaaaaaaaaaaaaaaaaaaaaa') };
    const b = { ref: new ObjectIdLike('bbbbbbbbbbbbbbbbbbbbbbbb') };
    // OLD: both digested `{"ref":{}}` — byte-identical, "unchanged".
    expect(() => canonicalDigest(a)).toThrow(CanonicalizeError);
    expect(() => canonicalDigest(b)).toThrow(CanonicalizeError);
  });

  it('rejects a nested class instance too', () => {
    expect(() => canonicalJson({ steps: [{ evidence: [new ObjectIdLike('x')] }] })).toThrow(
      CanonicalizeError,
    );
  });

  it('plain objects, null-prototype objects, arrays and Dates still pass', () => {
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.a = 1;
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson(nullProto)).toBe('{"a":1}');
    expect(canonicalJson([1, 'x', true, null])).toBe('[1,"x",true,null]');
    expect(canonicalJson({ at: new Date('2026-01-01T00:00:00.000Z') })).toBe(
      '{"at":{"$date":"2026-01-01T00:00:00.000Z"}}',
    );
  });
});
