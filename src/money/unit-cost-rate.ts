import { type MinorUnits, MinorUnits as toMinorUnits } from './money.js';

/**
 * A **unit cost rate** — a monetary rate PER UNIT that is genuinely fractional
 * and must NOT be confused with a monetary total.
 *
 * Weighted-average / FIFO valuation divides a total by a (possibly fractional)
 * quantity, so a unit rate routinely has sub-minor-unit precision:
 *
 *   total = 100 paisa, quantity = 3  →  unit rate = 33.333… paisa/unit
 *
 * Branding such a rate as `MinorUnits` (integer) would silently lose value.
 * Instead a rate is stored as a **scaled integer**: `scaledAmount` is
 * "minor units per unit × {@link RATE_SCALE}", so 33.333… paisa/unit with
 * `RATE_SCALE = 1e6` is `scaledAmount = 33_333_333`. Deterministic, no float
 * drift, no decimal runtime dependency.
 *
 * Round a rate to an integer monetary TOTAL only when producing an extended
 * amount, via {@link extendedAmount} — exactly once, at the emission boundary.
 *
 * For distributing a top-down amount (freight, a discount) across lines so the
 * parts reconcile EXACTLY to the total, use `allocate` from
 * `@classytic/primitives/split-allocation` (largest-remainder) — do not
 * hand-roll per-line rounding.
 */

import type { CurrencyCode } from './currency.js';

/** Fixed, ecosystem-wide rate scale: 6 decimal places below the minor unit. */
export const RATE_SCALE = 1_000_000;

/**
 * Quantity scale used internally so a fractional quantity (e.g. `2.5`, a UoM
 * split) participates in exact integer/bigint arithmetic. 6 dp of quantity
 * precision — quantities finer than 1e-6 unit are rounded to this grid.
 */
const QTY_SCALE = 1_000_000;

/** Half-to-even (banker's) is the default; half-up available for legacy parity. */
export type RoundingMode = 'half-even' | 'half-up';

const DEFAULT_ROUNDING: RoundingMode = 'half-even';

/**
 * Minor units per unit, stored as an integer scaled by {@link RATE_SCALE}.
 * `scale` is carried so a value is self-describing on the wire even if
 * `RATE_SCALE` ever changes; it is always `RATE_SCALE` today.
 */
export interface UnitCostRate<C extends string = string> {
  /** Integer: minor units per unit × `scale`. */
  readonly scaledAmount: number;
  readonly currency: C | CurrencyCode | string;
  /** Always {@link RATE_SCALE}. */
  readonly scale: number;
}

export type UnitCostRateErrorCode =
  | 'NOT_FINITE'
  | 'NEGATIVE'
  | 'NOT_INTEGER'
  | 'UNSAFE_INTEGER'
  | 'NON_POSITIVE_QUANTITY';

export class UnitCostRateError extends Error {
  override readonly name = 'UnitCostRateError';
  readonly code: UnitCostRateErrorCode;
  constructor(code: UnitCostRateErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function assertSafe(scaled: number): void {
  if (!Number.isFinite(scaled)) {
    throw new UnitCostRateError('NOT_FINITE', `unit cost rate is not finite: ${scaled}`);
  }
  if (!Number.isSafeInteger(scaled)) {
    throw new UnitCostRateError(
      'UNSAFE_INTEGER',
      `scaled unit cost ${scaled} exceeds Number.MAX_SAFE_INTEGER — value too large for this rate scale`,
    );
  }
}

/**
 * Scale a (possibly fractional) quantity onto the {@link QTY_SCALE} grid as a
 * bigint. Guards against a quantity so large that `quantity × QTY_SCALE` loses
 * integer precision as a double BEFORE reaching bigint (≈ >9e9 units).
 */
function scaleQuantity(quantity: number): bigint {
  const q = Math.round(quantity * QTY_SCALE);
  if (!Number.isSafeInteger(q)) {
    throw new UnitCostRateError(
      'UNSAFE_INTEGER',
      `quantity ${quantity} is too large to scale precisely — exceeds safe-integer range`,
    );
  }
  return BigInt(q);
}

/**
 * Construct a rate from a (possibly fractional) minor-units-per-unit value.
 *
 * @example unitCostRate(33.3333, 'BDT') // { scaledAmount: 33_333_300, ... }
 */
export function unitCostRate<C extends string = string>(
  minorPerUnit: number,
  currency: C,
): UnitCostRate<C> {
  if (!Number.isFinite(minorPerUnit)) {
    throw new UnitCostRateError('NOT_FINITE', `minorPerUnit is not finite: ${minorPerUnit}`);
  }
  if (minorPerUnit < 0) {
    throw new UnitCostRateError('NEGATIVE', `unit cost cannot be negative: ${minorPerUnit}`);
  }
  const scaledAmount = Math.round(minorPerUnit * RATE_SCALE);
  assertSafe(scaledAmount);
  return { scaledAmount, currency, scale: RATE_SCALE };
}

/**
 * Weighted-average constructor: the rate implied by an integer minor-unit
 * `totalMinor` spread over a (possibly fractional) `quantity`. This is the WAC
 * / layer-average rate. Overflow-safe via bigint; quantity rounded to the
 * {@link QTY_SCALE} grid.
 *
 * @example unitCostRateFromTotal(100, 3, 'BDT') // 33.333… paisa/unit
 */
export function unitCostRateFromTotal<C extends string = string>(
  totalMinor: number,
  quantity: number,
  currency: C,
): UnitCostRate<C> {
  if (!Number.isInteger(totalMinor)) {
    throw new UnitCostRateError(
      'NOT_INTEGER',
      `totalMinor must be integer minor units: ${totalMinor}`,
    );
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new UnitCostRateError('NON_POSITIVE_QUANTITY', `quantity must be > 0, got ${quantity}`);
  }
  const qScaled = scaleQuantity(quantity);
  // scaledAmount = round( totalMinor × RATE_SCALE / quantity )
  //             = round( totalMinor × RATE_SCALE × QTY_SCALE / qScaled )
  const numerator = BigInt(totalMinor) * BigInt(RATE_SCALE) * BigInt(QTY_SCALE);
  const scaled = Number(roundedDiv(numerator, qScaled, 'half-even'));
  assertSafe(scaled);
  return { scaledAmount: scaled, currency, scale: RATE_SCALE };
}

/**
 * The extended monetary amount for `quantity` units at `rate`, rounded to
 * integer {@link MinorUnits} — the ONE rate→total rounding boundary.
 *
 * `round(quantity × scaledAmount / RATE_SCALE)`, computed in bigint so large
 * amounts never lose precision. A fractional quantity is honoured to
 * {@link QTY_SCALE} precision.
 */
export function extendedAmount<C extends string = string>(
  rate: UnitCostRate<C>,
  quantity: number,
  mode: RoundingMode = DEFAULT_ROUNDING,
): MinorUnits<C> {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new UnitCostRateError('NON_POSITIVE_QUANTITY', `quantity must be >= 0, got ${quantity}`);
  }
  const qScaled = scaleQuantity(quantity);
  // minor = round( scaledAmount × quantity / RATE_SCALE )
  //       = round( scaledAmount × qScaled / (RATE_SCALE × QTY_SCALE) )
  const numerator = BigInt(rate.scaledAmount) * qScaled;
  const denominator = BigInt(rate.scale) * BigInt(QTY_SCALE);
  const minor = Number(roundedDiv(numerator, denominator, mode));
  if (!Number.isSafeInteger(minor)) {
    throw new UnitCostRateError(
      'UNSAFE_INTEGER',
      `extended amount ${minor} exceeds safe integer range`,
    );
  }
  return toMinorUnits<C>(minor, rate.currency as C);
}

/**
 * Incremental weighted-average of two scaled rates — the moving-average (WAC)
 * receipt step:
 *
 *   newRate = (onHandQty × onHandRate + inQty × inRate) / (onHandQty + inQty)
 *
 * Both rates must share the same scale (ecosystem-wide {@link RATE_SCALE});
 * the result is a scaled integer on that same scale. Bigint-exact with the
 * quantity honoured to {@link QTY_SCALE} precision; rounds once, at the end.
 *
 * Degenerate-stock semantics (the moving-average standard): a zero or
 * NEGATIVE on-hand contributes NOTHING to the average — the incoming rate
 * RESETS the cost. Averaging against a negative quantity would let a
 * catch-up receipt swing the rate arbitrarily far from any price ever paid.
 * Outflows never call this function: an issue leaves the average unchanged.
 */
export function weightedAverageScaledRate(
  onHandQuantity: number,
  onHandScaledRate: number,
  inQuantity: number,
  inScaledRate: number,
  mode: RoundingMode = DEFAULT_ROUNDING,
): number {
  if (!Number.isFinite(inQuantity) || inQuantity <= 0) {
    throw new UnitCostRateError(
      'NON_POSITIVE_QUANTITY',
      `incoming quantity must be > 0, got ${inQuantity}`,
    );
  }
  assertSafe(inScaledRate);
  const oldQty = Number.isFinite(onHandQuantity) ? Math.max(onHandQuantity, 0) : 0;
  if (oldQty === 0) return inScaledRate;
  assertSafe(onHandScaledRate);

  const oldQ = scaleQuantity(oldQty);
  const inQ = scaleQuantity(inQuantity);
  const numerator = oldQ * BigInt(onHandScaledRate) + inQ * BigInt(inScaledRate);
  const scaled = Number(roundedDiv(numerator, oldQ + inQ, mode));
  assertSafe(scaled);
  return scaled;
}

/** The rate as a plain (fractional) minor-units-per-unit number — for display only. */
export function rateMinorPerUnit(rate: UnitCostRate): number {
  return rate.scaledAmount / rate.scale;
}

/** Structural guard. */
export function isUnitCostRate(value: unknown): value is UnitCostRate {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isInteger((value as UnitCostRate).scaledAmount) &&
    typeof (value as UnitCostRate).currency === 'string' &&
    typeof (value as UnitCostRate).scale === 'number'
  );
}

/**
 * Rounded integer division of two bigints, `numerator / denominator`
 * (`denominator > 0`), honouring the rounding mode at the exact half.
 * Sign-safe for negative numerators.
 */
function roundedDiv(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const neg = numerator < 0n;
  const n = neg ? -numerator : numerator;
  const q = n / denominator;
  const remainder = n - q * denominator;
  if (remainder === 0n) return neg ? -q : q;

  const twiceRem = remainder * 2n;
  let up: boolean;
  if (twiceRem > denominator) {
    up = true;
  } else if (twiceRem < denominator) {
    up = false;
  } else {
    // exact half
    up = mode === 'half-up' ? true : q % 2n !== 0n; // half-even: round to even
  }
  const result = up ? q + 1n : q;
  return neg ? -result : result;
}
