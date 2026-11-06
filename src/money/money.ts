import type { CurrencyCode } from './currency.js';
import {
  CurrencyMismatchError,
  currencyCode,
  currencyExponent,
  isCurrencyCode,
  minorUnitFactor,
} from './currency.js';

export {
  CASH_DESTINATIONS,
  type CashDestination,
  cashDestinationLabel,
  isCashDestination,
} from './cash-destination.js';
/**
 * Re-exported so `@classytic/primitives/money` remains the import site every
 * consumer already uses. The class is DECLARED in `/currency` because the FX
 * seam there throws it, and a runtime import from `/currency` back into
 * `/money` would close an ESM cycle (`/money` imports `minorUnitFactor`).
 */
export { CurrencyMismatchError } from './currency.js';

/**
 * Wire-format monetary amount: integer minor units, branded with a phantom
 * currency type so calls like `formatBdt(usdValue)` fail at compile time.
 *
 * Use this for HTTP/JSON fields where transmitting a `Money` struct would be
 * overkill: `interface Order { grandTotal: MinorUnits<'BDT'>; ... }`. Pair
 * with the structured {@link Money} for in-process arithmetic.
 *
 * Erases at runtime — branded types have zero cost.
 *
 * @example
 * type Paisa = MinorUnits<'BDT'>;
 * type UsdCents = MinorUnits<'USD'>;
 * const p: Paisa = MinorUnits(489900, 'BDT');
 * const c: UsdCents = p; // ❌ type error: BDT vs USD
 */
declare const __unitBrand: unique symbol;
declare const __currencyBrand: unique symbol;

export type MinorUnits<C extends string = string> = number & {
  readonly [__unitBrand]: 'minor';
  readonly [__currencyBrand]: C;
};

/**
 * Cast a raw number to {@link MinorUnits}. Pass the currency as the second
 * argument to fix the phantom type. With no second arg, `MinorUnits<string>`
 * — useful for generic SDK boundaries that don't know the currency yet.
 *
 * @example
 * MinorUnits(489900, 'BDT')   // typed MinorUnits<'BDT'>
 * MinorUnits(199, 'USD')      // typed MinorUnits<'USD'>
 */
export function MinorUnits<C extends string = string>(
  amount: number,
  _currency?: C,
): MinorUnits<C> {
  return amount as MinorUnits<C>;
}

/**
 * A monetary amount stored as an integer in the currency's minor unit.
 *
 * Examples:
 *  - `{ amount: 19_99,   currency: 'USD' }` — 19.99 USD (2 decimals)
 *  - `{ amount: 1_500,   currency: 'JPY' }` — 1500 JPY (0 decimals)
 *  - `{ amount: 500_000, currency: 'KWD' }` — 500.000 KWD (3 decimals)
 *
 * Storing as integers avoids IEEE 754 rounding across arithmetic. Never store
 * `Money.amount` as a float.
 *
 * ## `currency` is a branded {@link CurrencyCode}, not a string
 *
 * It was declared `CurrencyCode | string`, and a union with `string` collapses
 * TO `string` — so the brand was decoration on the one type in the package
 * where it matters, and `money()` validated nothing. Any string reached the
 * field: `'jpy'`, `''`, `'US Dollar'`, a mistyped `'BTD'`. None of those are in
 * {@link MINOR_UNIT_FACTOR}; `minorUnitFactor` now throws for them.
 *
 * Construct through {@link money} / {@link fromMajor} (which validate and
 * brand) or through `currencyCode()` at your own boundary. A raw object literal
 * `{ amount, currency: someString }` is now a compile error — deliberately, so
 * the validation cannot be bypassed by the shape that skipped it before.
 */
export interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

/**
 * Construct {@link Money} from an integer minor-unit amount.
 *
 * @throws TypeError if `amount` is not a finite integer.
 * @throws InvalidCurrencyCodeError if `currency` is not ISO 4217 format.
 */
export function money(amount: number, currency: string): Money {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new TypeError(`Money.amount must be a finite integer in minor units, got ${amount}`);
  }
  return { amount, currency: currencyCode(currency) };
}

/**
 * Construct {@link Money} from a major-unit number (e.g. dollars, taka) by
 * scaling to the currency's minor unit and rounding half-away-from-zero.
 *
 * Uses `toPrecision(15)` to strip the trailing-bit noise that appears in
 * multiply-then-round (e.g. `0.1 + 0.2 = 0.30000000000000004`). This is
 * enough for the vast majority of decimals encountered in real-world pricing.
 *
 * **Precision caveat.** A handful of decimals cannot be represented exactly
 * in IEEE 754 and will round to the IEEE-closest integer rather than the
 * mathematically-expected one — e.g. `1.005` is stored as `1.00499999…` and
 * rounds to `100` minor units, not `101`. If you need decimal-exact rounding,
 * construct money from a string or use integer minor units directly via
 * {@link money}.
 *
 * @example
 * fromMajor(19.99, 'USD')      // { amount: 1999, currency: 'USD' }
 * fromMajor(0.1 + 0.2, 'USD')  // { amount: 30,   currency: 'USD' }
 * fromMajor(1500,  'JPY')      // { amount: 1500, currency: 'JPY' }
 */
export function fromMajor(major: number, currency: string): Money {
  if (!Number.isFinite(major)) {
    throw new TypeError(`fromMajor received non-finite value: ${major}`);
  }
  // Format first, so a malformed code reports as malformed rather than as unknown.
  const code = currencyCode(currency);
  const raw = major * minorUnitFactor(code);
  // Strip IEEE trailing-bit noise — `Number(n.toPrecision(15))` snaps
  // 0.30000000000000004 back to 0.3 while leaving genuine values untouched.
  const cleaned = Number(raw.toPrecision(15));
  const sign = cleaned < 0 ? -1 : 1;
  const amount = Math.round(Math.abs(cleaned)) * sign;
  return { amount, currency: code };
}

/** Convert {@link Money} back to its major-unit floating-point representation. */
export function toMajor(m: Money): number {
  return m.amount / minorUnitFactor(m.currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

/**
 * Multiply money by a scalar. The result is rounded to an integer number of
 * minor units using half-away-from-zero rounding.
 */
export function multiplyMoney(m: Money, scalar: number): Money {
  if (!Number.isFinite(scalar)) {
    throw new TypeError(`multiplyMoney received non-finite scalar: ${scalar}`);
  }
  const raw = m.amount * scalar;
  const sign = raw < 0 ? -1 : 1;
  const rounded = Math.round(Math.abs(raw)) * sign;
  return { amount: rounded, currency: m.currency };
}

/** Sum a list of {@link Money}. Returns zero in the given currency for empty input. */
export function sumMoney(values: readonly Money[], currency: string): Money {
  return values.reduce<Money>((acc, v) => addMoney(acc, v), {
    amount: 0,
    currency: currencyCode(currency),
  });
}

/** Strict equality (amount and currency both match). */
export function equalsMoney(a: Money, b: Money): boolean {
  return a.amount === b.amount && a.currency === b.currency;
}

/**
 * Ordering predicate. Returns -1, 0, or 1. Throws on currency mismatch — use
 * {@link equalsMoney} for a total equality check across currencies.
 */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export function isZeroMoney(m: Money): boolean {
  return m.amount === 0;
}

export function isPositiveMoney(m: Money): boolean {
  return m.amount > 0;
}

export function isNegativeMoney(m: Money): boolean {
  return m.amount < 0;
}

export function negateMoney(m: Money): Money {
  // Avoid producing -0 when amount is 0 — `-0` survives JSON round-trips
  // inconsistently and breaks structural equality with plain zero.
  return { amount: m.amount === 0 ? 0 : -m.amount, currency: m.currency };
}

export function absMoney(m: Money): Money {
  return m.amount < 0 ? negateMoney(m) : m;
}

// ── Scalar minor-unit helpers (bare numbers, exponent read from the currency) ─
//
// The ledger family works on BARE integer minor-unit numbers, not on the
// structured {@link Money} value. These helpers take the CURRENCY and read its
// exponent through `currencyExponent`, which throws for an unknown code — there
// is no default exponent. Their rounding deliberately differs from {@link fromMajor}:
// raw IEEE `Math.round(major * 10^d)` (half-up toward +∞, no `toPrecision`
// cleaning), so `majorToMinorUnits(1.005, 'USD') === 100` where
// `fromMajor(1.005, 'USD').amount === 101`. That freezes the ledger's
// characterization-tested posting behavior. New Money-struct code should prefer
// `fromMajor`/`toMajor`.

/**
 * Decimal major-unit number → integer minor units at the currency's exponent.
 * Throws `UnknownCurrencyError` for an unknown currency and `RangeError` when the
 * result leaves the safe-integer range (also catches `NaN`/`Infinity` inputs).
 *
 * @example
 * majorToMinorUnits(10.5, 'USD')   // 1050
 * majorToMinorUnits(1000, 'JPY')   // 1000
 * majorToMinorUnits(1.234, 'KWD')  // 1234
 */
export function majorToMinorUnits(major: number, currency: string): number {
  const factor = 10 ** currencyExponent(currency);
  const minor = Math.round(major * factor);
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(
      `Amount ${major} exceeds safe integer limit when converted to minor units. ` +
        `Max safe amount: ${Number.MAX_SAFE_INTEGER / factor}`,
    );
  }
  return minor;
}

/** Integer minor units → major-unit number at the currency's exponent: `(1050, 'USD') → 10.5`, `(1000, 'JPY') → 1000`. */
export function minorUnitsToMajor(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}

/**
 * Percentage of an integer minor-unit amount → integer minor units.
 * EXACT multiply-then-round: `Math.round((minor × ratePercent) / 100)` —
 * one rounding point, half-up toward +∞. Handles genuinely fractional rates
 * (QST 9.975 %) without precision loss: `percentOfMinor(20000, 9.975) === 1995`.
 *
 * Hosts whose domain guarantees at-most-2-decimal rates MAY snap the rate to
 * integer basis points BEFORE calling (be-prod's `#shared/money` seam does) —
 * that is host policy layered on top, not part of this primitive.
 */
export function percentOfMinor(minor: number, ratePercent: number): number {
  if (!Number.isFinite(minor) || !Number.isFinite(ratePercent)) {
    throw new TypeError(
      `percentOfMinor received non-finite input: minor=${minor}, ratePercent=${ratePercent}`,
    );
  }
  return Math.round((minor * ratePercent) / 100);
}

/**
 * Integer minor units → plain decimal string at the currency's exponent (no symbol, no locale):
 * `(10550, 'USD') → "105.50"`, `(1000, 'JPY') → "1000"`, `(1234, 'KWD') → "1.234"`.
 * For localized currency strings use `Intl.NumberFormat` at the display layer.
 */
export function formatMinorUnits(minor: number, currency: string): string {
  const decimals = currencyExponent(currency);
  return (minor / 10 ** decimals).toFixed(decimals);
}

/** Structural type guard. */
export function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Money).amount === 'number' &&
    Number.isInteger((value as Money).amount) &&
    // Format-checked, not merely `typeof === 'string'`. The loose check
    // accepted `{ amount: 1, currency: '' }` as valid Money, which is the shape
    // a stripped or defaulted field arrives in.
    isCurrencyCode((value as Money).currency)
  );
}
