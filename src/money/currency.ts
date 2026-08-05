import type { Brand } from '../composition/brand.js';
// TYPE-only: `/money` imports `minorUnitFactor` from here at runtime, so a
// value import back would be a genuine ESM cycle. Everything this file needs
// from Money is erased at build time.
import type { Money } from './money.js';

/**
 * ISO 4217 currency code (3 uppercase letters).
 *
 * Branded `string` — any 3-letter string is structurally valid, but the brand
 * prevents accidental mixing with raw strings. Use {@link toCurrencyCode} to
 * construct one safely.
 */
export type CurrencyCode = Brand<string, 'CurrencyCode'>;

/**
 * Common ISO 4217 codes. Non-exhaustive — add more at the consumer level if
 * needed. Listed here because shared-types ships with these by default.
 */
export const CURRENCIES = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  JPY: 'JPY',
  CNY: 'CNY',
  INR: 'INR',
  BDT: 'BDT',
  AED: 'AED',
  SAR: 'SAR',
  PKR: 'PKR',
  NPR: 'NPR',
  LKR: 'LKR',
  MYR: 'MYR',
  SGD: 'SGD',
  AUD: 'AUD',
  CAD: 'CAD',
  CHF: 'CHF',
  HKD: 'HKD',
  THB: 'THB',
  IDR: 'IDR',
} as const satisfies Record<string, string>;

/**
 * Number of minor units per major unit, by ISO 4217 code.
 *
 * **This table must list EVERY currency whose exponent is not 2.** ISO 4217
 * defaults to 2 decimals, and {@link minorUnitFactor} falls back to 100 for a
 * code it does not know — which is correct for the ~150 two-decimal currencies
 * and catastrophically wrong for the others. A missing zero-decimal entry does
 * not throw: it makes `fromMajor(1500, 'GNF')` store 150 000 minor units, a
 * 100× error that reads as a plausible number all the way to the gateway.
 *
 * So the exceptions are enumerated EXHAUSTIVELY (all 0-, 3- and 4-decimal
 * codes), leaving the `?? 100` fallback reachable only by a code that is not a
 * real ISO 4217 currency — a typo, a lowercased code, or a placeholder. The
 * two-decimal entries below are redundant with the default and kept only as
 * documentation of the common set.
 */
export const MINOR_UNIT_FACTOR: Readonly<Record<string, number>> = {
  USD: 100,
  EUR: 100,
  GBP: 100,
  JPY: 1,
  CNY: 100,
  INR: 100,
  BDT: 100,
  AED: 100,
  SAR: 100,
  PKR: 100,
  NPR: 100,
  LKR: 100,
  MYR: 100,
  SGD: 100,
  AUD: 100,
  CAD: 100,
  CHF: 100,
  HKD: 100,
  THB: 100,
  IDR: 100,
  // ── exponent 0 — no minor unit at all (ISO 4217 exhaustive) ──────────────
  BIF: 1,
  CLP: 1,
  DJF: 1,
  GNF: 1,
  ISK: 1,
  KMF: 1,
  KRW: 1,
  PYG: 1,
  RWF: 1,
  UGX: 1,
  UYI: 1,
  VND: 1,
  VUV: 1,
  XAF: 1,
  XOF: 1,
  XPF: 1,
  // ── exponent 3 — millimes / fils (ISO 4217 exhaustive) ───────────────────
  BHD: 1000,
  IQD: 1000,
  JOD: 1000,
  KWD: 1000,
  LYD: 1000,
  OMR: 1000,
  TND: 1000,
  // ── exponent 4 — indexed units (ISO 4217 exhaustive) ─────────────────────
  CLF: 10_000,
  UYW: 10_000,
};

/**
 * ISO 4217 format — 3 uppercase letters. Exported so consumers can embed
 * the SAME pattern in JSON-Schema-representable validators (zod `.regex`,
 * Mongoose `match`, OpenAPI `pattern`) instead of hand-rolling a copy:
 * `.refine(isCurrencyCode)` validates at runtime but is dropped by
 * `z.toJSONSchema`, losing the constraint from generated API docs.
 * `isCurrencyCode` / `toCurrencyCode` remain the runtime API.
 */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Narrow a raw string to a {@link CurrencyCode}. Returns `null` if the string
 * is not a valid ISO 4217 format (3 uppercase letters). This does not verify
 * the code is registered with ISO — use your own whitelist for that.
 */
export function toCurrencyCode(value: string): CurrencyCode | null {
  return CURRENCY_PATTERN.test(value) ? (value as CurrencyCode) : null;
}

/**
 * Validate + brand, or throw. The constructor form — same relationship to
 * {@link toCurrencyCode} that `civilDate` has to `isCivilDate`.
 *
 * `Money` carries a {@link CurrencyCode}, not a bare string, and this is where
 * an untrusted value earns the brand. Rejecting `'jpy'` here matters: lowercase
 * misses {@link MINOR_UNIT_FACTOR}, so it silently becomes a 2-decimal currency
 * and every JPY amount is off by 100×.
 */
export function currencyCode(value: string): CurrencyCode {
  const code = toCurrencyCode(value);
  if (code === null) {
    throw new InvalidCurrencyCodeError(value);
  }
  return code;
}

export class InvalidCurrencyCodeError extends Error {
  override readonly name = 'InvalidCurrencyCodeError';
  readonly value: string;

  constructor(value: string) {
    super(
      `Invalid ISO 4217 currency code '${value}' — expected three uppercase letters. ` +
        'A code that misses the minor-unit table is assumed to have two decimals, which is a 100× error for JPY-style currencies.',
    );
    this.value = value;
  }
}

/**
 * Raised when an operation combines two currencies.
 *
 * Declared HERE rather than in `/money` so the FX seam below can throw it
 * without a runtime import back into `/money` (which imports
 * {@link minorUnitFactor} from this file). `/money` re-exports it, so
 * `import { CurrencyMismatchError } from '@classytic/primitives/money'` still
 * resolves.
 */
export class CurrencyMismatchError extends Error {
  override readonly name = 'CurrencyMismatchError';
  readonly left: string;
  readonly right: string;

  constructor(left: string, right: string) {
    super(`Currency mismatch: ${left} vs ${right}`);
    this.left = left;
    this.right = right;
  }
}

/** Type predicate for `unknown` input. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCY_PATTERN.test(value);
}

/**
 * Minor units per major unit (100 for USD, 1 for JPY, 1000 for KWD, 10 000 for CLF).
 *
 * Falls back to 100 for an unlisted code — the ISO 4217 default exponent. Because
 * {@link MINOR_UNIT_FACTOR} enumerates every non-2-decimal currency, that fallback
 * is now only reached by codes that are not ISO 4217 currencies at all; use
 * {@link isKnownCurrency} at a config/boot boundary if you need to reject those
 * rather than assume two decimals for them.
 */
export function minorUnitFactor(currency: string): number {
  return MINOR_UNIT_FACTOR[currency] ?? 100;
}

/**
 * Does {@link MINOR_UNIT_FACTOR} carry an explicit exponent for this code?
 *
 * `false` means {@link minorUnitFactor} would ASSUME two decimals. That
 * assumption is right for an ordinary ISO 4217 code and wrong by 100× for a
 * mistyped or lowercased one (`'jpy'`), so a boot-time config validator that
 * accepts an operator-supplied currency should gate on this instead of letting
 * the default answer for it.
 */
export function isKnownCurrency(currency: string): boolean {
  return Object.hasOwn(MINOR_UNIT_FACTOR, currency);
}

/**
 * Frozen FX conversion record — the cost of record for cross-currency
 * transactions. Stored alongside a base-currency amount at the seam where
 * currency crossed (procurement receipt, landed-cost entry, foreign refund).
 *
 * Invariant: once written, never mutated. Revaluation is a new snapshot on
 * a new document — rewriting an existing snapshot corrupts audit history.
 *
 * `rate` is expressed as: 1 sourceCurrency = rate * baseCurrency
 * (e.g. USD→BDT at 110 means rate = 110, so sourceAmount 10 USD → baseAmount 1100 BDT).
 * This matches how banks quote — the source is the "from" currency.
 */
export interface FxSnapshot {
  /** Currency the transaction was invoiced / quoted in. ISO 4217. */
  sourceCurrency: string;
  /** Organisation's functional currency the base amount is expressed in. */
  baseCurrency: string;
  /** 1 unit of sourceCurrency equals this many units of baseCurrency. */
  rate: number;
  /** When the rate was captured — NOT when the document was last touched. */
  snapshotAt: Date;
  /**
   * Optional provenance tag — e.g. 'manual', 'bangladesh-bank',
   * 'openexchangerates.org', 'supplier-invoice'. Free-form; hosts use it for
   * audit filtering and re-pricing policy.
   */
  source?: string;
}

/**
 * How to land a converted amount on an integer number of minor units.
 * Required to be deterministic and named, never implicit — the old signature
 * returned an unrounded float and left the choice to whoever persisted it, so
 * two call sites rounding differently produced two answers for one conversion.
 */
export type FxRounding = 'half-away-from-zero' | 'floor' | 'ceil';

function roundMinor(raw: number, mode: FxRounding): number {
  if (mode === 'floor') return Math.floor(raw);
  if (mode === 'ceil') return Math.ceil(raw);
  const sign = raw < 0 ? -1 : 1;
  return Math.round(Math.abs(raw)) * sign;
}

/**
 * Apply an {@link FxSnapshot} to a source-currency amount.
 *
 * ## Why this takes `Money` and not a number
 *
 * It used to take a bare `number`, which meant nothing could check the amount
 * was denominated in `fx.sourceCurrency`. Applying a USD→BDT snapshot to a EUR
 * amount type-checked, ran, and returned a plausible wrong number — the
 * arithmetic is identical, only the meaning is wrong, so no test that asserts a
 * total would notice. Taking `Money` lets the seam enforce its own
 * precondition: a mismatch throws {@link CurrencyMismatchError}.
 *
 * ## Minor-unit exponents are handled
 *
 * The rate is quoted in MAJOR units (1 source = `rate` base), while `Money`
 * holds minor units, and the two currencies need not share an exponent
 * (USD has 2, JPY has 0). The conversion therefore goes
 * `minor → major → ×rate → base minor`, not a naive `amount × rate`, which is
 * off by 100× for any pair whose exponents differ.
 */
export function convertWithSnapshot(
  source: Money,
  fx: FxSnapshot,
  options: { rounding?: FxRounding } = {},
): Money {
  if (source.currency !== fx.sourceCurrency) {
    throw new CurrencyMismatchError(source.currency, fx.sourceCurrency);
  }
  if (!Number.isFinite(fx.rate)) {
    throw new TypeError(`FxSnapshot.rate must be finite, got ${fx.rate}`);
  }
  const major = source.amount / minorUnitFactor(fx.sourceCurrency);
  const raw = major * fx.rate * minorUnitFactor(fx.baseCurrency);
  return {
    amount: roundMinor(raw, options.rounding ?? 'half-away-from-zero'),
    currency: currencyCode(fx.baseCurrency),
  };
}

/**
 * Reverse an {@link FxSnapshot} — reconstruct the source-currency amount
 * from a stored base amount. Useful for reporting "cost in original
 * currency". Not round-trip safe under rounding; prefer storing the
 * original source amount alongside the base amount when audit fidelity
 * matters.
 *
 * Symmetrically guarded: a base amount that is not in `fx.baseCurrency` throws
 * rather than dividing by a rate that does not describe it.
 */
export function reverseWithSnapshot(
  base: Money,
  fx: FxSnapshot,
  options: { rounding?: FxRounding } = {},
): Money {
  if (base.currency !== fx.baseCurrency) {
    throw new CurrencyMismatchError(base.currency, fx.baseCurrency);
  }
  if (fx.rate === 0 || !Number.isFinite(fx.rate)) {
    throw new TypeError(`FxSnapshot.rate must be a non-zero finite number, got ${fx.rate}`);
  }
  const major = base.amount / minorUnitFactor(fx.baseCurrency);
  const raw = (major / fx.rate) * minorUnitFactor(fx.sourceCurrency);
  return {
    amount: roundMinor(raw, options.rounding ?? 'half-away-from-zero'),
    currency: currencyCode(fx.sourceCurrency),
  };
}

/**
 * Structural validation — checks shape only. Does NOT verify the rate is
 * economically sensible (8.5 USD→BDT would pass this check). Host-level
 * guards / anomaly detection handle that.
 */
export function isFxSnapshot(value: unknown): value is FxSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sourceCurrency === 'string' &&
    typeof v.baseCurrency === 'string' &&
    typeof v.rate === 'number' &&
    Number.isFinite(v.rate) &&
    v.rate > 0 &&
    v.snapshotAt instanceof Date
  );
}
