import type { Brand } from '../composition/brand.js';

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
 * Number of minor units per major unit for common currencies.
 *
 * ISO 4217 defines most currencies with 2 decimal places (cents). A few are
 * zero-decimal (JPY, KRW) or three-decimal (BHD, KWD, JOD). When a currency
 * isn't in this table, {@link minorUnitFactor} returns 100 as the safe default.
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
  KRW: 1,
  VND: 1,
  BHD: 1000,
  KWD: 1000,
  JOD: 1000,
  OMR: 1000,
  TND: 1000,
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

/** Type predicate for `unknown` input. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCY_PATTERN.test(value);
}

/**
 * Minor units per major unit (e.g. 100 for USD, 1 for JPY, 1000 for KWD).
 * Falls back to 100 when the currency is unknown — matches the ISO 4217 default.
 */
export function minorUnitFactor(currency: string): number {
  return MINOR_UNIT_FACTOR[currency] ?? 100;
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
 * Apply an {@link FxSnapshot} to a source-currency amount. Returns the
 * equivalent base-currency amount. No rounding — callers that persist into
 * an integer minor-unit column must round explicitly with a deterministic
 * rule (`Math.round`, banker's rounding, floor for duty-conservative
 * postings, etc.).
 */
export function convertWithSnapshot(sourceAmount: number, fx: FxSnapshot): number {
  return sourceAmount * fx.rate;
}

/**
 * Reverse an {@link FxSnapshot} — reconstruct the source-currency amount
 * from a stored base amount. Useful for reporting "cost in original
 * currency". Not round-trip safe under rounding; prefer storing the
 * original source amount alongside the base amount when audit fidelity
 * matters.
 */
export function reverseWithSnapshot(baseAmount: number, fx: FxSnapshot): number {
  if (fx.rate === 0) throw new Error('FxSnapshot.rate must be non-zero');
  return baseAmount / fx.rate;
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
