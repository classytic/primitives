/** How a quoted price extends across a sellable quantity. */
export type PriceBasis = FixedPriceBasis | MeasuredPriceBasis;

export interface FixedPriceBasis {
  readonly kind: 'fixed';
}

export type MeasureDimension = 'mass' | 'duration' | 'volume' | 'length' | 'area';

export interface MeasuredPriceBasis {
  readonly kind: 'measured';
  readonly dimension: MeasureDimension;
  /** Unit carried by the line quantity, such as `gram` or `minute`; the quantity may be fractional. */
  readonly quantityUnit: string;
  /** Unit named by the quoted price, such as `kilogram` or `hour`. */
  readonly priceUnit: string;
  /** Number of quantity units represented by one quoted price unit. */
  readonly quantityPerPriceUnit: number;
}

export type PriceBasisErrorCode =
  | 'INVALID_PRICE'
  | 'INVALID_QUANTITY'
  | 'INVALID_DENOMINATOR'
  | 'INVALID_UNIT'
  | 'UNSAFE_TOTAL';

export class PriceBasisError extends Error {
  override readonly name = 'PriceBasisError';
  readonly code: PriceBasisErrorCode;

  constructor(code: PriceBasisErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function fixedPriceBasis(): FixedPriceBasis {
  return { kind: 'fixed' };
}

export function measuredPriceBasis(
  dimension: MeasureDimension,
  quantityUnit: string,
  priceUnit: string,
  quantityPerPriceUnit: number,
): MeasuredPriceBasis {
  if (quantityUnit.trim() === '' || priceUnit.trim() === '') {
    throw new PriceBasisError('INVALID_UNIT', 'quantityUnit and priceUnit must not be empty');
  }
  if (!Number.isSafeInteger(quantityPerPriceUnit) || quantityPerPriceUnit <= 0) {
    throw new PriceBasisError(
      'INVALID_DENOMINATOR',
      'quantityPerPriceUnit must be a positive safe integer',
    );
  }
  return { kind: 'measured', dimension, quantityUnit, priceUnit, quantityPerPriceUnit };
}

const MEASURE_DIMENSIONS = new Set<MeasureDimension>([
  'mass',
  'duration',
  'volume',
  'length',
  'area',
]);

/** Structural guard for database and wire boundaries. */
export function isPriceBasis(value: unknown): value is PriceBasis {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    kind?: unknown;
    dimension?: unknown;
    quantityUnit?: unknown;
    priceUnit?: unknown;
    quantityPerPriceUnit?: unknown;
  };
  if (candidate.kind === 'fixed') return true;
  return (
    candidate.kind === 'measured' &&
    MEASURE_DIMENSIONS.has(candidate.dimension as MeasureDimension) &&
    typeof candidate.quantityUnit === 'string' &&
    candidate.quantityUnit.trim() !== '' &&
    typeof candidate.priceUnit === 'string' &&
    candidate.priceUnit.trim() !== '' &&
    typeof candidate.quantityPerPriceUnit === 'number' &&
    Number.isSafeInteger(candidate.quantityPerPriceUnit) &&
    candidate.quantityPerPriceUnit > 0
  );
}

/**
 * Extend a minor-unit price across a non-negative quantity, exactly, on the 6-dp quantity grid,
 * rounding once (half-even). A quantity off the grid throws.
 */
export function resolvePriceBasisTotal(
  unitPriceMinor: number,
  quantity: number,
  basis: PriceBasis = fixedPriceBasis(),
): number {
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new PriceBasisError(
      'INVALID_PRICE',
      'unitPriceMinor must be a non-negative safe integer',
    );
  }
  if (!(quantity >= 0) || !(Number.isSafeInteger(quantity) || isOnQuantityGrid(quantity))) {
    throw new PriceBasisError(
      'INVALID_QUANTITY',
      `quantity ${quantity} must be a non-negative integer, or a fraction on the 1/${QUANTITY_SCALE} grid`,
    );
  }

  // A whole quantity keeps the exact integer path (its full safe range); only a fraction goes through the grid.
  const whole = Number.isSafeInteger(quantity);
  const perPriceUnit = basis.kind === 'measured' ? BigInt(basis.quantityPerPriceUnit) : 1n;
  const numerator = BigInt(unitPriceMinor) * (whole ? BigInt(quantity) : quantityToGrid(quantity));
  const denominator = whole ? perPriceUnit : perPriceUnit * BigInt(QUANTITY_SCALE);
  const rounded = roundedDiv(numerator, denominator, 'half-even');
  const total = Number(rounded);
  if (!Number.isSafeInteger(total)) {
    throw new PriceBasisError('UNSAFE_TOTAL', 'resolved total exceeds Number.MAX_SAFE_INTEGER');
  }
  return total;
}

import { isOnQuantityGrid, QUANTITY_SCALE, quantityToGrid } from '../inventory/quantity.js';
import { roundedDiv } from './rounded-div.js';
