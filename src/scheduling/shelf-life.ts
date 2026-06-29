/**
 * Shelf-life / lot-tracking policy + pure expiry-date derivation.
 *
 * Describes whether a SKU is tracked by lot/serial, whether it carries an
 * expiration date, and the day-offsets used to derive the four lifecycle
 * dates of a freshly-received lot. The *policy* is product-level metadata
 * (owned by a catalog); the *derived dates* are per-lot facts (owned by a
 * WMS). This module is the shared contract both speak so the shape can't
 * drift between packages.
 *
 * Modeled on Odoo's `product_expiry` addon, which puts `tracking` +
 * `use_expiration_date` and four integer day-deltas on `product.template`,
 * then computes four dates on each `stock.lot`:
 *
 *   expiration = receivedAt + shelfLifeDays
 *   bestBefore = expiration − bestBeforeDays   (still safe, starts deteriorating)
 *   removal    = expiration − removalDays      (stop selling — FEFO sorts on THIS)
 *   alert      = expiration − alertDays         (raise a reminder)
 *
 * Consumed by `@classytic/catalog` (variant tracking policy) and
 * `@classytic/flow` (lot date derivation at receipt, FEFO, fresh-on-hand).
 *
 * Zero-dep, pure UTC day arithmetic — safe in unit tests with no clock.
 *
 * @example
 * const policy: ShelfLifePolicy = {
 *   mode: 'lot',
 *   useExpiration: true,
 *   shelfLifeDays: 540,   // 18-month medicine
 *   removalDays: 30,      // pull 30 days before expiry
 *   alertDays: 60,        // remind 60 days before expiry
 * };
 * deriveShelfLifeDates(new Date('2026-01-01T00:00:00Z'), policy);
 * // → { expiresAt: 2027-06-25…, removalDate: 2027-05-26…, alertDate: 2027-04-26… }
 */

/** How a SKU's stock identity is tracked. Mirrors Odoo `product.tracking`. */
export type TrackingMode = 'none' | 'lot' | 'serial';

export interface ShelfLifePolicy {
  /** `'none'` = tracked by quantity only; `'lot'` = batch; `'serial'` = unique unit. */
  readonly mode: TrackingMode;
  /**
   * When `true`, received lots carry an expiration date and the freshness
   * lifecycle (best-before / removal / alert) applies. When `false`, the
   * SKU may still be lot/serial tracked for traceability but has no expiry.
   */
  readonly useExpiration: boolean;
  /**
   * Total shelf life in days: `expiration = receivedAt + shelfLifeDays`.
   * Omit to require a manual expiration date at receipt (no auto-derivation).
   */
  readonly shelfLifeDays?: number;
  /** Days before expiration when goods start deteriorating (best-before / use date). */
  readonly bestBeforeDays?: number;
  /**
   * Days before expiration when goods must be pulled from sellable stock.
   * This is the FEFO sort key and the fresh-on-hand cutoff — NOT the
   * expiration date itself.
   */
  readonly removalDays?: number;
  /** Days before expiration when an expiry reminder should fire. */
  readonly alertDays?: number;
}

/** The four lifecycle dates of a received lot. All optional — only what the policy can derive. */
export interface ShelfLifeDates {
  readonly expiresAt?: Date;
  readonly bestBeforeDate?: Date;
  readonly removalDate?: Date;
  readonly alertDate?: Date;
}

export interface DeriveOptions {
  /**
   * Explicit expiration date — overrides `shelfLifeDays` derivation (manual
   * receiving, GS1-scanned expiry). The other three dates are then offset
   * back from THIS date, matching Odoo's edit-expiration behavior.
   */
  readonly expiresAt?: Date;
}

export type ShelfLifeErrorCode =
  | 'INVALID_MODE'
  | 'INVALID_DAYS'
  | 'INVALID_RECEIVED_AT'
  | 'INVALID_EXPIRES_AT';

export class ShelfLifeError extends Error {
  override readonly name = 'ShelfLifeError';
  readonly code: ShelfLifeErrorCode;

  constructor(code: ShelfLifeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TRACKING_MODES: readonly TrackingMode[] = ['none', 'lot', 'serial'];

/** True when the policy requires lot OR serial identity (i.e. lots get created). */
export function isTracked(policy: ShelfLifePolicy): boolean {
  return policy.mode !== 'none';
}

/** True when received lots carry an expiration date. */
export function isExpiryTracked(policy: ShelfLifePolicy): boolean {
  return policy.mode !== 'none' && policy.useExpiration;
}

/** Validate a policy. Call before storing host-side. */
export function validateShelfLifePolicy(policy: ShelfLifePolicy): void {
  if (!TRACKING_MODES.includes(policy.mode)) {
    throw new ShelfLifeError('INVALID_MODE', `mode must be one of ${TRACKING_MODES.join(', ')}, got ${String(policy.mode)}`);
  }
  for (const [key, val] of [
    ['shelfLifeDays', policy.shelfLifeDays],
    ['bestBeforeDays', policy.bestBeforeDays],
    ['removalDays', policy.removalDays],
    ['alertDays', policy.alertDays],
  ] as const) {
    if (val === undefined) continue;
    if (!Number.isFinite(val) || val < 0) {
      throw new ShelfLifeError('INVALID_DAYS', `${key} must be a non-negative number, got ${String(val)}`);
    }
  }
}

/**
 * Derive the four lifecycle dates for a lot received at `receivedAt`.
 *
 * Returns an empty object when the policy does not track expiry (`mode:
 * 'none'` or `useExpiration: false`) and no explicit `expiresAt` override is
 * given. Each of the three sub-dates is emitted only when both an expiration
 * date resolves AND the corresponding offset is present in the policy.
 *
 * Offsets are clamped to never produce a date before `receivedAt` (an offset
 * larger than the shelf life would otherwise yield a removal date in the
 * past on day one).
 */
export function deriveShelfLifeDates(
  receivedAt: Date,
  policy: ShelfLifePolicy,
  opts: DeriveOptions = {},
): ShelfLifeDates {
  validateShelfLifePolicy(policy);
  if (Number.isNaN(receivedAt.getTime())) {
    throw new ShelfLifeError('INVALID_RECEIVED_AT', 'receivedAt is not a valid Date');
  }
  if (opts.expiresAt && Number.isNaN(opts.expiresAt.getTime())) {
    throw new ShelfLifeError('INVALID_EXPIRES_AT', 'opts.expiresAt is not a valid Date');
  }

  // Resolve the expiration date: explicit override wins over shelf-life math.
  let expiresAt: Date | undefined;
  if (opts.expiresAt) {
    expiresAt = opts.expiresAt;
  } else if (isExpiryTracked(policy) && policy.shelfLifeDays !== undefined) {
    expiresAt = addDays(receivedAt, policy.shelfLifeDays);
  }

  if (!expiresAt) return {};

  const floor = receivedAt.getTime();
  const offsetBack = (days: number | undefined): Date | undefined =>
    days === undefined ? undefined : new Date(Math.max(floor, expiresAt.getTime() - days * DAY_MS));

  const dates: ShelfLifeDates = {
    expiresAt,
    ...defined('bestBeforeDate', offsetBack(policy.bestBeforeDays)),
    ...defined('removalDate', offsetBack(policy.removalDays)),
    ...defined('alertDate', offsetBack(policy.alertDays)),
  };
  return dates;
}

export type ShelfLifeStatus = 'none' | 'fresh' | 'alert' | 'removed' | 'expired';

/**
 * Classify a lot's freshness as of `asOf`. `'removed'` means past its removal
 * date (excluded from fresh-on-hand even though not yet expired); `'expired'`
 * means past the hard expiration date. Returns `'none'` when no dates apply.
 *
 * Precedence (most severe first): expired > removed > alert > fresh.
 */
export function shelfLifeStatus(dates: ShelfLifeDates, asOf: Date): ShelfLifeStatus {
  const now = asOf.getTime();
  if (!dates.expiresAt && !dates.removalDate && !dates.alertDate) return 'none';
  if (dates.expiresAt && now >= dates.expiresAt.getTime()) return 'expired';
  if (dates.removalDate && now >= dates.removalDate.getTime()) return 'removed';
  if (dates.alertDate && now >= dates.alertDate.getTime()) return 'alert';
  return 'fresh';
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function defined<K extends string, V>(key: K, val: V | undefined): Record<K, V> | Record<string, never> {
  return val === undefined ? {} : ({ [key]: val } as Record<K, V>);
}
