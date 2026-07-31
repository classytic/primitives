import type { Money } from './money.js';
import { allocate } from './split-allocation.js';

/**
 * Pure proration ARITHMETIC — fraction / period / allocation / rounding only.
 *
 * This module deliberately holds **no commercial policy**. It does not know
 * what "an upgrade" is, whether a discount is creditable, how tax is treated,
 * or whether a downgrade yields cash vs store credit. Those decisions live in
 * the subscription/contract kernel (`@classytic/contract`
 * `calculatePlanChangeProration(...)`), which composes these primitives.
 *
 * It is also **timezone-agnostic**: callers pass already-resolved `Date`
 * instants (normalized to the deployment's business timezone via
 * `@classytic/primitives/timezone` upstream). This module never reads a clock
 * and never applies an offset — pass instants, get numbers.
 *
 * Money is integer minor units throughout; splits use the largest-remainder
 * allocator so `consumed + remaining === amount` exactly, with no penny drift.
 */

const MS_PER_DAY = 86_400_000;

/**
 * How to count days within a period.
 *
 * - `'whole_day'` (default) — integer calendar-day counts. Callers normalize
 *   `periodStart`/`periodEnd`/`asOf` to business-local midnight first, so this
 *   matches "day-of-month" proration (the Stripe default, how ~99% of SaaS
 *   bill). `periodDays` is clamped to `>= 1`.
 * - `'exact'` — fractional wall-clock day counts (`ms / 86_400_000`). Use when
 *   cycles are short and a partial day must be billed precisely.
 */
export type ProrationGranularity = 'whole_day' | 'exact';

/** The elapsed/remaining split of a billing period at a change instant. */
export interface PeriodFraction {
  /** Total days in the period. `>= 1` for `whole_day`; `> 0` for `exact`. */
  readonly periodDays: number;
  /** Days consumed as of the change instant, clamped to `[0, periodDays]`. */
  readonly elapsedDays: number;
  /** `periodDays - elapsedDays`. */
  readonly remainingDays: number;
  /** `remainingDays / periodDays`, in `[0, 1]`. */
  readonly remainingFraction: number;
}

export interface PeriodProgressInput {
  /** Period start instant (business-tz-normalized by the caller). */
  readonly periodStart: Date;
  /** Period end instant — must be strictly after `periodStart`. */
  readonly periodEnd: Date;
  /** The change/quote instant. Clamped into `[periodStart, periodEnd]`. */
  readonly asOf: Date;
  /** Day-counting granularity. Default `'whole_day'`. */
  readonly granularity?: ProrationGranularity;
}

export type ProrationErrorCode = 'INVALID_PERIOD' | 'INVALID_FRACTION';

export class ProrationError extends Error {
  override readonly name = 'ProrationError';
  readonly code: ProrationErrorCode;
  constructor(code: ProrationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function isValidDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Compute how much of a period is elapsed vs remaining at `asOf`.
 *
 * `asOf` before the period start ⇒ nothing elapsed (full remaining);
 * `asOf` after the period end ⇒ fully elapsed (nothing remaining).
 *
 * @throws ProrationError('INVALID_PERIOD') if a date is invalid or
 *   `periodEnd <= periodStart`.
 */
export function periodProgress(input: PeriodProgressInput): PeriodFraction {
  const { periodStart, periodEnd, asOf, granularity = 'whole_day' } = input;
  if (!isValidDate(periodStart) || !isValidDate(periodEnd) || !isValidDate(asOf)) {
    throw new ProrationError('INVALID_PERIOD', 'periodStart, periodEnd and asOf must be valid Dates');
  }
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();
  if (endMs <= startMs) {
    throw new ProrationError(
      'INVALID_PERIOD',
      `periodEnd (${periodEnd.toISOString()}) must be after periodStart (${periodStart.toISOString()})`,
    );
  }

  const clampedAsOfMs = Math.min(Math.max(asOf.getTime(), startMs), endMs);

  const rawPeriodDays = (endMs - startMs) / MS_PER_DAY;
  const rawElapsedDays = (clampedAsOfMs - startMs) / MS_PER_DAY;

  let periodDays: number;
  let elapsedDays: number;
  if (granularity === 'whole_day') {
    periodDays = Math.max(1, Math.round(rawPeriodDays));
    elapsedDays = Math.min(periodDays, Math.max(0, Math.round(rawElapsedDays)));
  } else {
    periodDays = rawPeriodDays;
    elapsedDays = Math.min(periodDays, Math.max(0, rawElapsedDays));
  }

  const remainingDays = periodDays - elapsedDays;
  return {
    periodDays,
    elapsedDays,
    remainingDays,
    remainingFraction: remainingDays / periodDays,
  };
}

/**
 * Split a `Money` amount into its consumed and remaining parts across a
 * {@link PeriodFraction}, drift-free: `consumed.amount + remaining.amount ===
 * amount.amount` exactly (largest-remainder allocation). Sign is preserved, so
 * a negative amount (a reversal) splits symmetrically.
 *
 * This is the load-bearing primitive for proration: the "unused value" a
 * plan-change credits is `remaining`; the "already-consumed value" is
 * `consumed`.
 */
export function splitByPeriodFraction(
  amount: Money,
  fraction: PeriodFraction,
): { readonly consumed: Money; readonly remaining: Money } {
  const result = allocate(
    amount.amount,
    [
      { id: 'consumed', weight: fraction.elapsedDays },
      { id: 'remaining', weight: fraction.remainingDays },
    ],
    'by-weight',
  );
  const consumed = result.parts.find((p) => p.id === 'consumed')?.amount ?? 0;
  const remaining = result.parts.find((p) => p.id === 'remaining')?.amount ?? 0;
  return {
    consumed: { amount: consumed, currency: amount.currency },
    remaining: { amount: remaining, currency: amount.currency },
  };
}

/**
 * Allocate the `fraction`-weighted part of a `Money` amount, drift-free — the
 * complement (`1 - fraction`) is discarded but computed so rounding is exact
 * against the whole. `fraction` must be in `[0, 1]`.
 *
 * @throws ProrationError('INVALID_FRACTION') if `fraction` is outside `[0, 1]`
 *   or not finite.
 */
export function allocateMoneyByFraction(amount: Money, fraction: number): Money {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new ProrationError('INVALID_FRACTION', `fraction must be in [0, 1], got ${fraction}`);
  }
  const result = allocate(
    amount.amount,
    [
      { id: 'part', weight: fraction },
      { id: 'rest', weight: 1 - fraction },
    ],
    'by-weight',
  );
  const part = result.parts.find((p) => p.id === 'part')?.amount ?? 0;
  return { amount: part, currency: amount.currency };
}
