/** How a quoted price extends across a sellable quantity. */
export type PriceBasis = FixedPriceBasis | MeasuredPriceBasis;

export interface FixedPriceBasis {
  readonly kind: 'fixed';
}

export type MeasureDimension = 'mass' | 'duration' | 'volume' | 'length' | 'area';

export interface MeasuredPriceBasis {
  readonly kind: 'measured';
  readonly dimension: MeasureDimension;
  /** Integer unit carried by the line quantity, such as `gram` or `minute`. */
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

/** Extend a minor-unit price using integer quantity and exact half-even rounding. */
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
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new PriceBasisError('INVALID_QUANTITY', 'quantity must be a non-negative safe integer');
  }

  const numerator = BigInt(unitPriceMinor) * BigInt(quantity);
  const denominator = basis.kind === 'measured' ? BigInt(basis.quantityPerPriceUnit) : 1n;
  const rounded = roundedDiv(numerator, denominator, 'half-even');
  const total = Number(rounded);
  if (!Number.isSafeInteger(total)) {
    throw new PriceBasisError('UNSAFE_TOTAL', 'resolved total exceeds Number.MAX_SAFE_INTEGER');
  }
  return total;
}

import { roundedDiv } from './rounded-div.js';
