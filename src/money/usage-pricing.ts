/**
 * Price a measured amount against a {@link UsageRating}: the courier rate card
 * ("60 for the first kg, 20 per started kg after"), a metered call bundle, a per-seat licence.
 *
 * Rounding is the scheme's step, always UP: a started unit is a unit.
 *   - `per_unit` / `tiered` / `volume` price `ceil(measured - includedUnits)`, floored at 0.
 *   - `package` prices `ceil(billableUnits / packageSize)` packages.
 * Float noise is snapped at 12 significant digits first, so `2.2 - 1.2` bills 1 unit, not 2.
 *
 * Every refusal is a {@link UsagePricingError} with a closed `code`; nothing prices as 0 by default.
 *
 * Not `./price-basis`: a measured PriceBasis extends ONE rate linearly across the line QUANTITY
 * (rice at 120/kg). A usage measure is a separate input that sets the UNIT PRICE through a stepped
 * table; the line keeps its own quantity (two 2.3 kg parcels = quantity 2, measure 2.3 kg).
 */

import type { UsageRating, UsageTier } from './monetization.js';
import type { Money } from './money.js';

/** What ONE unit of a sale line measured: `{ value: 2.3, unit: 'kg' }`. `unit` must equal the rating's `unitLabel`. */
export interface UsageMeasure {
  readonly value: number;
  readonly unit: string;
}

/** Structural guard for wire and database boundaries: a positive finite value and a non-blank unit. */
export function isUsageMeasure(value: unknown): value is UsageMeasure {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { value?: unknown; unit?: unknown };
  return (
    typeof candidate.value === 'number' &&
    Number.isFinite(candidate.value) &&
    candidate.value > 0 &&
    typeof candidate.unit === 'string' &&
    candidate.unit.trim() !== ''
  );
}

export type UsagePricingErrorCode =
  | 'INVALID_MEASURE'
  | 'INVALID_INCLUDED_UNITS'
  | 'UNKNOWN_SCHEME'
  | 'MISSING_PER_UNIT'
  | 'MISSING_TIERS'
  | 'INVALID_TIER'
  | 'MISSING_PACKAGE'
  | 'INVALID_MONEY'
  | 'CURRENCY_MISMATCH'
  | 'EXCEEDS_RATE_TABLE'
  | 'UNSAFE_TOTAL';

export class UsagePricingError extends Error {
  override readonly name = 'UsagePricingError';
  readonly code: UsagePricingErrorCode;

  constructor(code: UsagePricingErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** One priced line of the breakdown. All money fields are integer minor units. */
export interface UsageChargeLine {
  /** Index into `rating.tiers` for `tiered` / `volume`; `null` for `per_unit` / `package`. */
  readonly band: number | null;
  /** Units priced on this line — PACKAGES under the `package` scheme. */
  readonly quantity: number;
  /** Rate applied per `quantity` (0 when the band is flat-only). */
  readonly unitAmount: number;
  /** Flat charge for landing in the band (0 when none). */
  readonly flatAmount: number;
  /** `quantity × unitAmount + flatAmount`. */
  readonly amount: number;
}

/** The priced result and the facts that produced it — freeze this beside the price. */
export interface UsageCharge {
  readonly scheme: UsageRating['scheme'];
  readonly measured: number;
  readonly includedUnits: number;
  /** Whole units charged after `includedUnits`, rounded up. */
  readonly billableUnits: number;
  /** Packages charged — present only under the `package` scheme. */
  readonly packages?: number;
  readonly lines: readonly UsageChargeLine[];
  readonly amount: Money;
  readonly unitLabel?: string;
}

/**
 * Price `measured` units against `rating`.
 *
 * `tiered` (graduated) charges each band for the units that fall inside it, plus the band's
 * `flatPrice` when any unit lands there. `volume` charges ALL units at the band the total lands
 * in. A bounded final band refuses a larger amount (`EXCEEDS_RATE_TABLE`) — a courier that does
 * not carry 40 kg parcels says so, it does not quote them at the last rate.
 */
export function priceUsage(rating: UsageRating, measured: number): UsageCharge {
  if (typeof measured !== 'number' || !Number.isFinite(measured) || measured < 0) {
    throw new UsagePricingError(
      'INVALID_MEASURE',
      `measured must be a finite number >= 0, got ${String(measured)}`,
    );
  }
  const includedUnits = rating.includedUnits ?? 0;
  if (typeof includedUnits !== 'number' || !Number.isFinite(includedUnits) || includedUnits < 0) {
    throw new UsagePricingError(
      'INVALID_INCLUDED_UNITS',
      `includedUnits must be a finite number >= 0, got ${String(includedUnits)}`,
    );
  }

  const over = Number((measured - includedUnits).toPrecision(12));
  const billableUnits = over > 0 ? Math.ceil(over) : 0;
  const base = {
    scheme: rating.scheme,
    measured,
    includedUnits,
    billableUnits,
    ...(rating.unitLabel !== undefined ? { unitLabel: rating.unitLabel } : {}),
  };

  switch (rating.scheme) {
    case 'per_unit': {
      const rate = requireMoney(rating.perUnit, 'MISSING_PER_UNIT', 'per_unit needs perUnit');
      const lines = billableUnits > 0 ? [line(null, billableUnits, rate.amount, 0)] : [];
      return { ...base, lines, amount: total(lines, rate.currency) };
    }
    case 'package': {
      if (!Number.isSafeInteger(rating.packageSize) || (rating.packageSize ?? 0) <= 0) {
        throw new UsagePricingError(
          'MISSING_PACKAGE',
          'package needs packageSize as a positive integer',
        );
      }
      const price = requireMoney(
        rating.packagePrice,
        'MISSING_PACKAGE',
        'package needs packagePrice',
      );
      const packages = Math.ceil(billableUnits / (rating.packageSize as number));
      const lines = packages > 0 ? [line(null, packages, price.amount, 0)] : [];
      return { ...base, packages, lines, amount: total(lines, price.currency) };
    }
    case 'tiered':
    case 'volume': {
      const { tiers, currency } = validTiers(rating.tiers);
      const lines =
        rating.scheme === 'tiered' ? graduated(tiers, billableUnits) : volume(tiers, billableUnits);
      return { ...base, lines, amount: total(lines, currency) };
    }
    default: {
      const unknownScheme: never = rating.scheme;
      throw new UsagePricingError(
        'UNKNOWN_SCHEME',
        `unknown usage scheme: ${String(unknownScheme)}`,
      );
    }
  }
}

function requireMoney(
  value: Money | undefined,
  code: UsagePricingErrorCode,
  message: string,
): Money {
  if (!value) throw new UsagePricingError(code, message);
  assertMoney(value);
  return value;
}

function assertMoney(value: Money): void {
  if (
    !Number.isSafeInteger(value.amount) ||
    value.amount < 0 ||
    typeof value.currency !== 'string'
  ) {
    throw new UsagePricingError(
      'INVALID_MONEY',
      `a rate must be a non-negative integer minor amount with a currency, got ${JSON.stringify(value)}`,
    );
  }
}

type Currency = Money['currency'];

function validTiers(tiers: readonly UsageTier[] | undefined): {
  tiers: readonly UsageTier[];
  currency: Currency;
} {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new UsagePricingError(
      'MISSING_TIERS',
      'tiered and volume schemes need at least one tier',
    );
  }
  let currency: Currency | undefined;
  let previous = 0;
  tiers.forEach((tier, i) => {
    if (tier.perUnit === undefined && tier.flatPrice === undefined) {
      throw new UsagePricingError('INVALID_TIER', `tier ${i} has neither perUnit nor flatPrice`);
    }
    for (const money of [tier.perUnit, tier.flatPrice]) {
      if (money === undefined) continue;
      assertMoney(money);
      if (currency === undefined) currency = money.currency;
      else if (money.currency !== currency) {
        throw new UsagePricingError(
          'CURRENCY_MISMATCH',
          `tier ${i} is in ${money.currency}, the table in ${currency}`,
        );
      }
    }
    if (tier.upTo === undefined) {
      if (i !== tiers.length - 1) {
        throw new UsagePricingError(
          'INVALID_TIER',
          `tier ${i} is open-ended but is not the last tier`,
        );
      }
      return;
    }
    if (!Number.isSafeInteger(tier.upTo) || tier.upTo <= previous) {
      throw new UsagePricingError(
        'INVALID_TIER',
        `tier ${i} upTo must be an integer above the previous bound ${previous}, got ${String(tier.upTo)}`,
      );
    }
    previous = tier.upTo;
  });
  // Every tier carries at least one rate, so a non-empty table always set it.
  return { tiers, currency: currency as Currency };
}

function graduated(tiers: readonly UsageTier[], units: number): UsageChargeLine[] {
  const lines: UsageChargeLine[] = [];
  let floor = 0;
  for (let i = 0; i < tiers.length && floor < units; i++) {
    const tier = tiers[i] as UsageTier;
    const ceiling = tier.upTo ?? Number.POSITIVE_INFINITY;
    const inBand = Math.min(units, ceiling) - floor;
    lines.push(line(i, inBand, tier.perUnit?.amount ?? 0, tier.flatPrice?.amount ?? 0));
    floor = ceiling;
  }
  if (floor < units) throw exceeds(units, floor);
  return lines;
}

function volume(tiers: readonly UsageTier[], units: number): UsageChargeLine[] {
  if (units === 0) return [];
  const band = tiers.findIndex((tier) => tier.upTo === undefined || units <= tier.upTo);
  if (band === -1) throw exceeds(units, tiers[tiers.length - 1]?.upTo ?? 0);
  const tier = tiers[band] as UsageTier;
  return [line(band, units, tier.perUnit?.amount ?? 0, tier.flatPrice?.amount ?? 0)];
}

function exceeds(units: number, limit: number): UsagePricingError {
  return new UsagePricingError(
    'EXCEEDS_RATE_TABLE',
    `${units} units exceed the rate table's last bound ${limit}`,
  );
}

function line(
  band: number | null,
  quantity: number,
  unitAmount: number,
  flatAmount: number,
): UsageChargeLine {
  const amount = quantity * unitAmount + flatAmount;
  if (!Number.isSafeInteger(amount)) {
    throw new UsagePricingError('UNSAFE_TOTAL', 'usage charge exceeds Number.MAX_SAFE_INTEGER');
  }
  return { band, quantity, unitAmount, flatAmount, amount };
}

function total(lines: readonly UsageChargeLine[], currency: Currency): Money {
  const amount = lines.reduce((sum, l) => sum + l.amount, 0);
  if (!Number.isSafeInteger(amount)) {
    throw new UsagePricingError('UNSAFE_TOTAL', 'usage charge exceeds Number.MAX_SAFE_INTEGER');
  }
  return { amount, currency };
}
