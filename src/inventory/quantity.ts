/**
 * A decimal stock quantity snapped to its unit's rounding step, on the fixed
 * {@link QUANTITY_SCALE} grid (6 dp — the grid `unit-cost-rate` extends money on).
 *
 * Snap at every write boundary: `10 - 2.35 - 2.35` is `5.300000000000001` in
 * IEEE doubles, and a stored drift never comes back out.
 *
 * Rounding is half-even, the package's money mode: a quantity snap is a
 * per-event normalisation, and half-up biases a running stock balance upward
 * across thousands of weighings.
 */
import { type RoundingMode, roundedDiv } from '../money/rounded-div.js';

export type { RoundingMode } from '../money/rounded-div.js';

/**
 * Grid units per stock unit. Equal to `unit-cost-rate`'s internal `QTY_SCALE`;
 * `tests/unit/quantity.test.ts` pins the equality through `extendedAmount`.
 */
export const QUANTITY_SCALE = 1_000_000;

export type QuantityErrorCode = 'NOT_FINITE' | 'INVALID_STEP' | 'UNSAFE_QUANTITY';

export class QuantityError extends Error {
  override readonly name = 'QuantityError';
  readonly code: QuantityErrorCode;
  constructor(code: QuantityErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** A quantity as a signed integer count of grid units (sign-symmetric half-even). */
export function quantityToGrid(quantity: number): bigint {
  if (!Number.isFinite(quantity)) {
    throw new QuantityError('NOT_FINITE', `quantity must be finite, got ${quantity}`);
  }
  const scaled = Math.abs(quantity) * QUANTITY_SCALE;
  if (!Number.isSafeInteger(Math.ceil(scaled))) {
    throw new QuantityError(
      'UNSAFE_QUANTITY',
      `quantity ${quantity} exceeds the precise grid range`,
    );
  }
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  const up = frac > 0.5 || (frac === 0.5 && floor % 2 === 1);
  const magnitude = BigInt(up ? floor + 1 : floor);
  return quantity < 0 ? -magnitude : magnitude;
}

function gridToNumber(grid: bigint): number {
  const value = Number(grid) / QUANTITY_SCALE;
  return value === 0 ? 0 : value;
}

/** The step in grid units. Refuses a non-positive step, one finer than the grid, or one off it. */
export function quantityStepToGrid(step: number): bigint {
  if (!Number.isFinite(step) || step <= 0) {
    throw new QuantityError('INVALID_STEP', `rounding step must be a positive number, got ${step}`);
  }
  const grid = quantityToGrid(step);
  const scaled = step * QUANTITY_SCALE;
  if (grid === 0n || Math.abs(Number(grid) - scaled) > 1e-9 * Math.max(1, scaled)) {
    throw new QuantityError(
      'INVALID_STEP',
      `rounding step ${step} is not a multiple of 1/${QUANTITY_SCALE}`,
    );
  }
  return grid;
}

/**
 * Round `quantity` to the nearest multiple of `step` (default: the bare grid).
 *
 * @example snapQuantity(10 - 2.35 - 2.35, 0.001) // 5.3
 * @example snapQuantity(2.3505, 0.001)           // 2.35 (half-even)
 */
export function snapQuantity(
  quantity: number,
  step?: number,
  mode: RoundingMode = 'half-even',
): number {
  const grid = quantityToGrid(quantity);
  if (step === undefined) return gridToNumber(grid);
  const stepGrid = quantityStepToGrid(step);
  return gridToNumber(roundedDiv(grid, stepGrid, mode) * stepGrid);
}

/**
 * Does `value` lie ON the grid (within float noise)? Strict, unlike {@link isOnStep}, which snaps
 * first: `2.3500004` is off the grid here and on the 0.001 step there. Check this at an input
 * boundary, where a 7th decimal is a caller error rather than float drift.
 */
export function isOnQuantityGrid(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const scaled = value * QUANTITY_SCALE;
  const grid = Math.round(scaled);
  return (
    Number.isSafeInteger(grid) && Math.abs(grid - scaled) <= 1e-9 * Math.max(1, Math.abs(scaled))
  );
}

/** Is `quantity` a whole multiple of `step`, within half a grid unit? */
export function isOnStep(quantity: number, step: number): boolean {
  return quantityToGrid(quantity) % quantityStepToGrid(step) === 0n;
}

/** Compare two quantities on the grid: equal when they snap to the same grid unit. */
export function compareQuantity(a: number, b: number): -1 | 0 | 1 {
  const ga = quantityToGrid(a);
  const gb = quantityToGrid(b);
  return ga === gb ? 0 : ga < gb ? -1 : 1;
}

/** `compareQuantity(a, b) === 0`. */
export function quantitiesEqual(a: number, b: number): boolean {
  return compareQuantity(a, b) === 0;
}
