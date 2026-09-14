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
 *   - `pass`         — paid once, grants a TERM, never renews (a course access
 *                      pass, a gym or transit pass, a parking or day pass, a
 *                      term licence). See {@link PassMonetization}.
 */
export const MONETIZATION_KINDS = [
  'free',
  'one_time',
  'subscription',
  'bundle',
  'usage',
  'pass',
] as const;

export type MonetizationKind = (typeof MONETIZATION_KINDS)[number];

const MONETIZATION_KIND_SET = new Set<MonetizationKind>(MONETIZATION_KINDS);

/** True when `value` is one of the canonical kinds. */
export function isMonetizationKind(value: unknown): value is MonetizationKind {
  return typeof value === 'string' && MONETIZATION_KIND_SET.has(value as MonetizationKind);
}

/* ──────────────────────── upfront collection policy ─────────────────────── */

/**
 * HOW MUCH of a price is collected at the point of sale.
 *
 * Distinct from every neighbouring vocabulary, which is why it is its own:
 *
 *   - order's `PAYMENT_TERMS` (`prepaid` | `collect_on_delivery`) says WHEN.
 *   - `PaymentAllocationStatus` (`partial`, `allocated`…) says how much of a
 *     RECEIVED payment has been applied to what it settles.
 *   - revenue's `PARTIALLY_REFUNDED` is a transaction's own state.
 *
 * None of them answers "what do we charge this customer right now", and a host
 * that guesses charges either nothing or everything — opposite answers to the
 * same question.
 *
 * It lives here, beside {@link MONETIZATION_KINDS}, for the reason stated in
 * catalog's barrel: monetization is a CROSS-KERNEL contract. Catalog declares
 * the policy on a product, order turns it into tenders, revenue settles them.
 * Three packages reading one definition, none re-exporting it.
 *
 *   - `full_payment` — the whole price, before the sale completes.
 *   - `deposit`      — a fixed amount now, the balance outstanding on the
 *                      order and settled later by another tender. One provider
 *                      line instead of two, which matters when card fees are
 *                      charged per transaction.
 *   - `pay_later`    — nothing now. The order still records what is owed.
 *
 * ABSENCE means `full_payment` — the behaviour before this existed — so no
 * stored record changes meaning when a build that knows this field ships.
 */
export const UPFRONT_COLLECTION_MODES = ['full_payment', 'deposit', 'pay_later'] as const;

export type UpfrontCollectionMode = (typeof UPFRONT_COLLECTION_MODES)[number];

const UPFRONT_COLLECTION_MODE_SET = new Set<UpfrontCollectionMode>(UPFRONT_COLLECTION_MODES);

/**
 * Narrow an unknown value to a collection mode.
 *
 * Readers MUST treat `false` as UNKNOWN, never as `full_payment`: a record
 * written by a build that knows a mode this one does not has not said "charge
 * everything", and assuming so takes money nobody agreed to.
 */
export function isUpfrontCollectionMode(value: unknown): value is UpfrontCollectionMode {
  return (
    typeof value === 'string' && UPFRONT_COLLECTION_MODE_SET.has(value as UpfrontCollectionMode)
  );
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

/* ──────────────────────────── pass pricing detail ───────────────────────── */

/**
 * One buyable term: a price that grants access for a fixed span.
 *
 * Shaped like {@link SubscriptionPlan} on purpose (same `duration` +
 * `durationUnit` vocabulary, so a term means the same thing everywhere) and
 * kept separate on purpose: a plan carries `trialDays` and a renewal discount,
 * which are recurring-billing concepts a pass has none of. Reusing the plan
 * would re-blur the very line this kind exists to draw.
 */
export interface AccessPass {
  /** Internal key ('pass-30d', 'season', 'day'). Stable across edits. */
  readonly key: string;
  /** Display label ("1 month", "Season pass", "Day pass"). */
  readonly label: string;
  /** Price for this term in the default currency. */
  readonly price: Money;
  /** Explicit per-currency overrides. */
  readonly priceByCurrency?: MoneyByCurrency;
  /** Optional strikethrough / "was" price for this term. */
  readonly compareAtPrice?: Money;
  /** Length of access this term buys. */
  readonly duration: number;
  /** Unit of that length. */
  readonly durationUnit: DurationUnit;
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
 * Paid once, grants a TERM, never renews.
 *
 * The gap this closes: `one_time` prices a thing but says nothing about how
 * long it is yours, and `subscription` prices a term but means it RECURS. A
 * prepaid term fits neither, so hosts selling one reached for `subscription`
 * and then had to explain, wherever the value was read, that it does not
 * actually renew — a classification that needs a comment to be understood has
 * already failed, and `toRevenueMonetizationType` would have settled those
 * sales as subscriptions in the ledger.
 *
 * Buying again EXTENDS rather than renewing: nothing schedules a charge, the
 * buyer chooses when (or whether) to pay for the next term. A perpetual sale
 * is `one_time`, not a pass with an enormous duration: "forever" is the
 * absence of a term, not a long one.
 */
export interface PassMonetization {
  readonly type: 'pass';
  /** At least one term. Several means the buyer picks (1 month / 1 year). */
  readonly passes: readonly AccessPass[];
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
  | UsageMonetization
  | PassMonetization;

/* ─────────────────────────────── guards ─────────────────────────────────── */

export const isFreeMonetization = (m: Monetization): m is FreeMonetization => m.type === 'free';
export const isOneTimeMonetization = (m: Monetization): m is OneTimeMonetization =>
  m.type === 'one_time';
export const isSubscriptionMonetization = (m: Monetization): m is SubscriptionMonetization =>
  m.type === 'subscription';
export const isBundleMonetization = (m: Monetization): m is BundleMonetization =>
  m.type === 'bundle';
export const isUsageMonetization = (m: Monetization): m is UsageMonetization => m.type === 'usage';
export const isPassMonetization = (m: Monetization): m is PassMonetization => m.type === 'pass';

const APPROX_DAYS_PER_UNIT: Record<DurationUnit, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

/**
 * A term's length in APPROXIMATE days, for ORDERING AND LABELS ONLY.
 *
 * A month is 30 here and a year 365, which is wrong as a date and right as a
 * comparison: it answers "is this term longer than that one" and "call this
 * one '6 months'", both of which only need a stable ranking.
 *
 * NEVER compute an expiry from it. A term that ENDS on a date must be added
 * with calendar arithmetic (`addMonths` / `addYears`), or February and leap
 * years quietly short-change the buyer. That belongs to the host's date
 * library, not to a pure money value object.
 */
export function approxTermDays(duration: number, unit: DurationUnit): number {
  return duration * APPROX_DAYS_PER_UNIT[unit];
}

/**
 * The term a storefront leads with: the CHEAPEST, ties broken by the shortest
 * span so the answer is deterministic whatever order the passes were authored
 * in. One definition, because a card reading the cheapest while a checkout
 * defaulted to the first is the divergence {@link unitPriceOf} exists to stop.
 *
 * The tie-break compares SPANS, not the raw `duration`: "1 year" and "1 month"
 * are both `duration: 1`, so a number-only comparison ranks them by whichever
 * happened to be authored first.
 */
export function defaultPassOf(m: PassMonetization): AccessPass | null {
  let best: AccessPass | null = null;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const pass of m.passes) {
    const span = approxTermDays(pass.duration, pass.durationUnit);
    if (
      best === null ||
      pass.price.amount < best.price.amount ||
      (pass.price.amount === best.price.amount && span < bestSpan)
    ) {
      best = pass;
      bestSpan = span;
    }
  }
  return best;
}

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
 *   - `pass`         → the cheapest term's price (the "from" price a
 *                      storefront leads with), see {@link defaultPassOf}
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
    case 'pass':
      return defaultPassOf(m)?.price ?? null;
    case 'free':
    case 'usage':
      return null;
  }
}

/**
 * The strikethrough / MSRP price, for the kinds that carry one.
 *
 * Always paired with whatever {@link unitPriceOf} returned, so a card can
 * never strike through the "was" of one term beside the price of another:
 * `one_time` compares against its base price, `pass` against the term
 * `defaultPassOf` picked.
 */
export function compareAtPriceOf(m: Monetization): Money | null {
  if (m.type === 'one_time') return m.pricing.compareAtPrice ?? null;
  if (m.type === 'pass') return defaultPassOf(m)?.compareAtPrice ?? null;
  return null;
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
 * (one_time, bundle, a usage charge and a pass are all "a purchase
 * happened"). A `pass` in particular must NOT land on `subscription`: nothing
 * schedules a renewal, and a ledger that thinks otherwise forecasts revenue
 * that will never be billed.
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
