/**
 * Monetization — the ONE canonical contract for "how is this sold and priced".
 *
 * ## Why this lives in primitives
 *
 * Every commerce package had its own answer and they drifted:
 *   - `@classytic/catalog` — a rich discriminated union (`free | one_time |
 *     subscription | bundle`) carrying nested pricing.
 *   - `@classytic/revenue` — a flat wire enum (`free | purchase | subscription`)
 *     where `purchase` is catalog's `one_time` under a different name.
 *   - `@classytic/order` — nothing; a line snapshot recorded resolved numbers
 *     but never the KIND, so the catalog classification was lost at the order
 *     boundary and downstream (accounting, entitlements) had to re-guess.
 *
 * A product classified `one_time` in the catalog could not be equated to a
 * `purchase` in revenue by any shared type; `bundle` had nowhere to map. This
 * module is the single home so the classification survives end-to-end and the
 * mapping between a kernel's wire name and the canonical kind is written ONCE.
 *
 * ## Two orthogonal axes (Stripe / Zuora / Chargebee model)
 *
 *   1. KIND — the coarse classification (`MonetizationKind`). Small and stable.
 *   2. PRICING — how the amount is computed for that kind (flat, volume tiers,
 *      subscription plans, metered usage). Composed INTO the kind, so adding a
 *      rating model never grows the classification.
 *
 * The discriminants match `@classytic/catalog`'s existing values exactly, so a
 * host adopting this needs NO data migration — only `usage` is new (the metered
 * / per-seat extension point).
 *
 * PURE value objects: interfaces + guards + total mapping functions. No Zod, no
 * mongoose, no I/O — the shared schema layer (`@classytic/validation`) and the
 * persistence layers build on these, they are not built here.
 */

import type { Money } from './money.js';

/**
 * A map of currency code → {@link Money} for explicit per-currency pricing.
 * Explicit entries always win over a currency-conversion fallback.
 *
 * Canonical home (was hand-declared in `@classytic/catalog`; re-exported there
 * for back-compat). Belongs with money because it is a money-shaped value.
 */
export type MoneyByCurrency = Record<string, Money>;

/* ─────────────────────────── Kind (the coarse axis) ─────────────────────── */

/**
 * The canonical monetization kinds. Order is stable; append only.
 *
 *   - `free`         — no charge.
 *   - `one_time`     — charged once (catalog `one_time`; revenue `purchase`).
 *   - `subscription` — recurring plan / membership.
 *   - `bundle`       — a composite priced from its members.
 *   - `usage`        — metered / per-seat / consumption (billed per unit or in
 *                      arrears). The extension point for rating models.
 */
export const MONETIZATION_KINDS = ['free', 'one_time', 'subscription', 'bundle', 'usage'] as const;

export type MonetizationKind = (typeof MONETIZATION_KINDS)[number];

const MONETIZATION_KIND_SET = new Set<MonetizationKind>(MONETIZATION_KINDS);

/** True when `value` is one of the canonical kinds. */
export function isMonetizationKind(value: unknown): value is MonetizationKind {
  return typeof value === 'string' && MONETIZATION_KIND_SET.has(value as MonetizationKind);
}

/* ───────────────────────── one_time pricing detail ──────────────────────── */

/** A quantity-based price break. `price` (fixed override) XOR `discountPercent`. */
export interface PriceTier {
  /** Minimum quantity to qualify. */
  readonly minQuantity: number;
  /** Fixed override price for this tier. */
  readonly price?: Money;
  /** OR a percentage discount (0–100). Mutually exclusive with `price`. */
  readonly discountPercent?: number;
}

export interface OneTimePricing {
  /** Required base (list) price. */
  readonly basePrice: Money;
  /** Default currency (redundant with `basePrice.currency`, indexed for queries). */
  readonly currency: string;
  /** Optional strikethrough / MSRP price. */
  readonly compareAtPrice?: Money;
  /** Explicit per-currency price overrides. */
  readonly priceByCurrency?: MoneyByCurrency;
  /** Optional cost (role-gated — filtered for non-finance readers). */
  readonly costPrice?: Money;
  /** Optional volume tiers (quantity-based discounts). */
  readonly tiers?: readonly PriceTier[];
}

/* ──────────────────────── subscription pricing detail ───────────────────── */

export type DurationUnit = 'day' | 'week' | 'month' | 'year';

export interface SubscriptionPlan {
  /** Internal key ('monthly', 'quarterly', 'annual'). */
  readonly key: string;
  /** Display label ("Monthly", "Annual (save 20%)"). */
  readonly label: string;
  /** Base price for this plan in the default currency. */
  readonly price: Money;
  /** Explicit per-currency overrides. */
  readonly priceByCurrency?: MoneyByCurrency;
  /** Billing cycle length. */
  readonly duration: number;
  /** Unit of the billing cycle. */
  readonly durationUnit: DurationUnit;
  /** Optional free trial length in days. */
  readonly trialDays?: number;
  /** Optional auto-calculated discount vs the highest-frequency plan. */
  readonly discount?: number;
}

/* ─────────────────────────── usage pricing detail ───────────────────────── */

/**
 * One band of a metered rate table.
 *
 * `upTo` is the inclusive upper bound of the band; omit it for the final,
 * open-ended band. Within a band either a `perUnit` rate applies (per metered
 * unit) or a `flatPrice` (a stairstep charge for landing in the band).
 */
export interface UsageTier {
  readonly upTo?: number;
  readonly perUnit?: Money;
  readonly flatPrice?: Money;
}

/**
 * How a metered unit is priced. One `scheme`, composed with the fields it needs
 * — this single shape covers per-seat, metered, graduated, volume, package and
 * base-plus-overage without a separate kind for each.
 *
 *   - `per_unit` — price × quantity (per-seat licensing, flat metering).
 *   - `tiered`   — graduated: each unit priced at the rate of the band it falls in.
 *   - `volume`   — the WHOLE quantity priced at the band the total lands in.
 *   - `package`  — priced per package of `packageSize` units.
 *
 * `includedUnits` are free before metering starts (base-plus-overage when paired
 * with {@link UsageMonetization.baseFee}).
 */
export interface UsageRating {
  readonly scheme: 'per_unit' | 'tiered' | 'volume' | 'package';
  /** Flat per-unit rate (`per_unit` scheme). */
  readonly perUnit?: Money;
  /** Rate table (`tiered` / `volume` schemes). */
  readonly tiers?: readonly UsageTier[];
  /** Units per package and the package price (`package` scheme). */
  readonly packageSize?: number;
  readonly packagePrice?: Money;
  /** Free units before metering starts (base-plus-overage). */
  readonly includedUnits?: number;
  /** Display label for one unit ("seat", "GB", "call", "visit"). */
  readonly unitLabel?: string;
}

/* ─────────────────────────── the discriminated union ────────────────────── */

export interface FreeMonetization {
  readonly type: 'free';
}

export interface OneTimeMonetization {
  readonly type: 'one_time';
  readonly pricing: OneTimePricing;
}

export interface SubscriptionMonetization {
  readonly type: 'subscription';
  /** At least one plan is required. */
  readonly plans: readonly SubscriptionPlan[];
}

export interface BundleMonetization {
  readonly type: 'bundle';
  /** Optional fixed bundle price (overrides the dynamic sum). */
  readonly basePrice?: Money;
  /** How bundle pricing is computed. */
  readonly pricingMode: 'fixed' | 'dynamic';
  /** For `dynamic` mode, an optional 0–100 discount on the members' sum. */
  readonly dynamicDiscountPercent?: number;
}

/**
 * Metered / consumption pricing. The extension point for per-seat, metered,
 * graduated, volume, package and base-plus-overage — all via {@link UsageRating}
 * so the classification does not grow one kind per rating model.
 */
export interface UsageMonetization {
  readonly type: 'usage';
  /** Optional recurring base fee charged regardless of usage (base + overage). */
  readonly baseFee?: Money;
  /** How each metered unit is priced. */
  readonly rating: UsageRating;
  /** Settlement cadence when usage is billed in arrears. */
  readonly billingPeriod?: { readonly duration: number; readonly durationUnit: DurationUnit };
}

/**
 * The canonical monetization value object. The `type` discriminant selects the
 * pricing detail. Matches `@classytic/catalog`'s existing discriminants (so no
 * data migration) plus `usage`.
 */
export type Monetization =
  | FreeMonetization
  | OneTimeMonetization
  | SubscriptionMonetization
  | BundleMonetization
  | UsageMonetization;

/* ─────────────────────────────── guards ─────────────────────────────────── */

export const isFreeMonetization = (m: Monetization): m is FreeMonetization => m.type === 'free';
export const isOneTimeMonetization = (m: Monetization): m is OneTimeMonetization =>
  m.type === 'one_time';
export const isSubscriptionMonetization = (m: Monetization): m is SubscriptionMonetization =>
  m.type === 'subscription';
export const isBundleMonetization = (m: Monetization): m is BundleMonetization =>
  m.type === 'bundle';
export const isUsageMonetization = (m: Monetization): m is UsageMonetization => m.type === 'usage';

/** The kind of a monetization value (its discriminant, narrowed to the union). */
export const monetizationKindOf = (m: Monetization): MonetizationKind => m.type;

/* ─────────────────────────── price resolution ───────────────────────────── */

/**
 * The single headline unit price for a monetization, or `null` when there isn't
 * one. This is the ONE place that decides "which number is the price" per kind,
 * so a cart line, an order snapshot and a storefront card never re-`switch` on
 * `type` and drift (a host that read `plans[0].price` while another read
 * `plans[1]` is exactly the divergence this prevents).
 *
 *   - `one_time`     → the base (list) price
 *   - `subscription` → the first plan's price (the default / most-frequent plan)
 *   - `bundle`       → the FIXED bundle price; `null` in `dynamic` mode (that
 *                      price is computed from the members, not stored here)
 *   - `free`         → `null`
 *   - `usage`        → `null` — a metered item has no single unit price; it is
 *                      rated per consumption via {@link UsageRating}
 *
 * Exhaustive on purpose: a new kind fails to compile here until it declares how
 * it prices, instead of silently returning `null`.
 */
export function unitPriceOf(m: Monetization): Money | null {
  switch (m.type) {
    case 'one_time':
      return m.pricing.basePrice;
    case 'subscription':
      return m.plans[0]?.price ?? null;
    case 'bundle':
      return m.basePrice ?? null;
    case 'free':
    case 'usage':
      return null;
  }
}

/** The strikethrough / MSRP price, if the kind carries one (only `one_time`). */
export function compareAtPriceOf(m: Monetization): Money | null {
  return m.type === 'one_time' ? (m.pricing.compareAtPrice ?? null) : null;
}

/* ───────────────── reconciliation with revenue's wire enum ───────────────── */

/**
 * `@classytic/revenue`'s coarse wire enum. `purchase` is the paid-once case that
 * the rest of the ecosystem calls `one_time`. Kept as its own type so revenue's
 * PERSISTED values never have to change — only the mapping to the canonical kind
 * lives here, in one place, instead of an implicit hand-conversion per call site.
 */
export type RevenueMonetizationType = 'free' | 'purchase' | 'subscription';

/**
 * Canonical kind → revenue wire type. Everything that is not `free` or
 * `subscription` settles as a `purchase` in revenue's ledger vocabulary
 * (one_time, bundle, and a usage charge are all "a purchase happened").
 */
export function toRevenueMonetizationType(kind: MonetizationKind): RevenueMonetizationType {
  if (kind === 'free') return 'free';
  if (kind === 'subscription') return 'subscription';
  return 'purchase';
}

/** Revenue wire type → canonical kind (`purchase` → `one_time`). */
export function fromRevenueMonetizationType(type: RevenueMonetizationType): MonetizationKind {
  if (type === 'free') return 'free';
  if (type === 'subscription') return 'subscription';
  return 'one_time';
}
