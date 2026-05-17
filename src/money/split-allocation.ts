/**
 * Deterministic integer allocation across N subjects.
 *
 * Given a `total` and a set of `subjects`, distribute the total across the
 * subjects in integer minor units using a chosen `method`. The sum of the
 * returned parts is *exactly* equal to `total` — no drift, no lost pennies —
 * via the largest-remainder method.
 *
 * Designed for landed-cost allocation (flow), commission payout splits
 * (commission), tax allocation (bd-tax), and payment splits (revenue).
 *
 * @example
 * // Allocate 1000 cents of freight across 3 line items by weight.
 * allocate(1000, [
 *   { id: 'L1', weight: 2 },
 *   { id: 'L2', weight: 3 },
 *   { id: 'L3', weight: 5 },
 * ], 'by-weight');
 * // → { total: 1000, method: 'by-weight', parts: [
 * //     { id: 'L1', amount: 200, weight: 2 },
 * //     { id: 'L2', amount: 300, weight: 3 },
 * //     { id: 'L3', amount: 500, weight: 5 },
 * //   ] }
 *
 * @example
 * // Residue goes to the largest fractional remainder, deterministic.
 * allocate(100, [
 *   { id: 'A', weight: 1 },
 *   { id: 'B', weight: 1 },
 *   { id: 'C', weight: 1 },
 * ], 'by-weight');
 * // → parts sum to 100: [34, 33, 33] (first-order tie-break on residue)
 */

/**
 * Allocation method. Proportional methods (`by-qty` | `by-weight` | `by-volume`
 * | `by-value`) share the same algorithm — the label carries *semantic* meaning
 * for downstream audit trails ("this cost was split by volume, not by value").
 * `by-percent` validates the weights sum to 100. `equal` ignores weights.
 */
export type SplitMethod =
  | 'equal'
  | 'by-qty'
  | 'by-weight'
  | 'by-volume'
  | 'by-value'
  | 'by-percent';

export interface SplitSubject {
  /** Caller-supplied identifier, preserved on the matching part. */
  readonly id: string;
  /** Non-negative numeric weight for proportional methods. Required unless `method === 'equal'` or `'by-percent'`. */
  readonly weight?: number;
  /** Percent in [0, 100] for `method === 'by-percent'`. Sum across subjects must equal 100 (± 0.001). */
  readonly percent?: number;
}

export interface SplitPart {
  readonly id: string;
  /** Integer in the same unit as `total`. */
  readonly amount: number;
  /** The effective weight used for this subject (for audit trails). */
  readonly weight: number;
}

export interface SplitResult {
  /** Echoes the input total. Always equals `sum(parts[i].amount)` exactly. */
  readonly total: number;
  readonly method: SplitMethod;
  readonly parts: readonly SplitPart[];
}

export type SplitAllocationErrorCode =
  | 'INVALID_TOTAL'
  | 'EMPTY_SUBJECTS'
  | 'INVALID_WEIGHT'
  | 'INVALID_PERCENT'
  | 'ZERO_WEIGHT_SUM'
  | 'DUPLICATE_SUBJECT_ID';

export class SplitAllocationError extends Error {
  override readonly name = 'SplitAllocationError';
  readonly code: SplitAllocationErrorCode;

  constructor(code: SplitAllocationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Tolerance for `by-percent` sum validation — accommodates floating-point drift on typical inputs. */
const PERCENT_TOLERANCE = 0.001;

/**
 * Allocate `total` across `subjects` using `method`. Returns one part per
 * subject, in input order. `sum(parts[i].amount) === total` is guaranteed.
 *
 * Rounding residue is distributed via the largest-remainder method: the
 * subjects with the largest fractional share get +1 (or -1 for negative
 * totals) until the residue is exhausted. Ties are broken by input order —
 * identical inputs always produce identical outputs.
 *
 * @throws SplitAllocationError — see {@link SplitAllocationErrorCode} for cases.
 */
export function allocate(
  total: number,
  subjects: readonly SplitSubject[],
  method: SplitMethod,
): SplitResult {
  if (!Number.isFinite(total) || !Number.isInteger(total)) {
    throw new SplitAllocationError('INVALID_TOTAL', `total must be a finite integer, got ${total}`);
  }

  if (subjects.length === 0) {
    if (total === 0) {
      return { total: 0, method, parts: [] };
    }
    throw new SplitAllocationError(
      'EMPTY_SUBJECTS',
      `cannot allocate non-zero total (${total}) across zero subjects`,
    );
  }

  const seenIds = new Set<string>();
  for (const s of subjects) {
    if (seenIds.has(s.id)) {
      throw new SplitAllocationError('DUPLICATE_SUBJECT_ID', `duplicate subject id: ${s.id}`);
    }
    seenIds.add(s.id);
  }

  const weights = resolveWeights(subjects, method);
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  const parts = distribute(absTotal, weights);

  const resultParts: SplitPart[] = parts.map((amount, i): SplitPart => {
    const subj = subjects[i];
    const w = weights[i];
    if (subj === undefined || w === undefined) {
      throw new Error('split-allocation invariant: parts, subjects, and weights out of sync');
    }
    return { id: subj.id, amount: amount * sign, weight: w };
  });

  return { total, method, parts: resultParts };
}

/**
 * Resolve the effective numeric weight per subject based on method.
 * Validates inputs and throws on bad data.
 */
function resolveWeights(subjects: readonly SplitSubject[], method: SplitMethod): number[] {
  if (method === 'equal') {
    return subjects.map(() => 1);
  }

  if (method === 'by-percent') {
    const percents = subjects.map((s, i) => {
      const p = s.percent;
      if (p === undefined) {
        throw new SplitAllocationError(
          'INVALID_PERCENT',
          `subject[${i}] (id=${s.id}) missing percent for method='by-percent'`,
        );
      }
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        throw new SplitAllocationError(
          'INVALID_PERCENT',
          `subject[${i}] (id=${s.id}) percent must be in [0, 100], got ${p}`,
        );
      }
      return p;
    });
    const sum = percents.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > PERCENT_TOLERANCE) {
      throw new SplitAllocationError(
        'INVALID_PERCENT',
        `percents must sum to 100 (±${PERCENT_TOLERANCE}), got ${sum}`,
      );
    }
    return percents;
  }

  // Proportional methods: by-qty | by-weight | by-volume | by-value
  const weights = subjects.map((s, i) => {
    const w = s.weight;
    if (w === undefined) {
      throw new SplitAllocationError(
        'INVALID_WEIGHT',
        `subject[${i}] (id=${s.id}) missing weight for method='${method}'`,
      );
    }
    if (!Number.isFinite(w) || w < 0) {
      throw new SplitAllocationError(
        'INVALID_WEIGHT',
        `subject[${i}] (id=${s.id}) weight must be finite and non-negative, got ${w}`,
      );
    }
    return w;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    throw new SplitAllocationError(
      'ZERO_WEIGHT_SUM',
      `sum of weights is zero — cannot allocate proportionally`,
    );
  }
  return weights;
}

/**
 * Core largest-remainder distributor. Operates on non-negative `total` and
 * non-negative `weights` with `sum(weights) > 0`. Guarantees:
 *   sum(result) === total
 *   result.length === weights.length
 *   determinism (ties broken by input order).
 */
function distribute(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);

  // Even-distribution shortcut avoids a multiply by zero producing NaN when
  // every weight is zero *and* total is zero (we've already rejected the
  // zero-weight-sum case with a non-zero total above).
  if (weightSum === 0) {
    return weights.map(() => 0);
  }

  const raw = weights.map((w) => (total * w) / weightSum);
  const floored = raw.map((r) => Math.floor(r));
  const residue = total - floored.reduce((a, b) => a + b, 0);

  if (residue === 0) {
    return floored;
  }

  // Rank by fractional remainder descending; tie → lower index first.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return a.i - b.i;
    });

  const result = floored.slice();
  for (let k = 0; k < residue; k++) {
    const entry = order[k];
    if (entry === undefined) break;
    result[entry.i] = (result[entry.i] ?? 0) + 1;
  }
  return result;
}

/** True if `sum(parts[i].amount) === result.total`. Useful as an assertion in host code. */
export function isBalanced(result: SplitResult): boolean {
  const sum = result.parts.reduce((acc, p) => acc + p.amount, 0);
  return sum === result.total;
}
