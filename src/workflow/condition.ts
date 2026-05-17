/**
 * Tiny JSON-serializable predicate DSL + evaluator.
 *
 * Hosts need to express "when this is true, do that" rules in places that
 * can't carry code — SLA scope filters, drip-sequence branches ("if opened
 * within 24h"), automation triggers, permission row-scopes. A 60-line
 * predicate spec covers every realistic case better than a hand-rolled
 * SQL-like grammar.
 *
 * Two layers:
 *   1. `Condition` — pure data. JSON-safe. Round-trips through DB.
 *   2. `evaluate(condition, value)` — pure function. Walks a dotted-path
 *      expression on `value`, applies the comparator, returns boolean.
 *
 * No regex parsing, no AST tooling, no string interpolation — the grammar
 * is structurally typed and the evaluator is a 30-line switch.
 *
 * @example Single comparison
 *   evaluate({ field: 'status', op: 'eq', value: 'won' }, opportunity);
 *
 * @example Composite — drip "if opened in last 7d AND not clicked"
 *   evaluate(
 *     {
 *       all: [
 *         { field: 'lastOpenedAt', op: 'gte', value: sevenDaysAgo },
 *         { field: 'lastClickedAt', op: 'isNull' },
 *       ],
 *     },
 *     contactEngagement,
 *   );
 */

// ─── Grammar ─────────────────────────────────────────────────────────────

/**
 * Comparators. Kept small — every operator here has a single, unambiguous
 * semantic across types. `in` accepts an array; `contains` accepts a single
 * scalar against an array field; `startsWith`/`endsWith` are string-only;
 * `isNull` / `isNotNull` have no `value`.
 */
export type Comparator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'isNotNull';

/** Atomic predicate: extract `field` from the target, compare to `value`. */
export interface FieldCondition {
  /** Dotted path: `'contact.email'`, `'metadata.utm.source'`, etc. */
  readonly field: string;
  readonly op: Comparator;
  /** Comparand. Omitted for `isNull` / `isNotNull`. */
  readonly value?: unknown;
}

/** All branches must be true. */
export interface AllCondition {
  readonly all: readonly Condition[];
}

/** Any branch true short-circuits true. */
export interface AnyCondition {
  readonly any: readonly Condition[];
}

/** Inverts the wrapped condition. */
export interface NotCondition {
  readonly not: Condition;
}

export type Condition =
  | FieldCondition
  | AllCondition
  | AnyCondition
  | NotCondition;

// ─── Type guards (also stable JSON shape detectors) ───────────────────────

function isFieldCondition(c: Condition): c is FieldCondition {
  return (
    typeof (c as FieldCondition).field === 'string' &&
    typeof (c as FieldCondition).op === 'string'
  );
}
function isAllCondition(c: Condition): c is AllCondition {
  return Array.isArray((c as AllCondition).all);
}
function isAnyCondition(c: Condition): c is AnyCondition {
  return Array.isArray((c as AnyCondition).any);
}
function isNotCondition(c: Condition): c is NotCondition {
  return typeof (c as NotCondition).not === 'object' && (c as NotCondition).not !== null;
}

// ─── Evaluator ────────────────────────────────────────────────────────────

/**
 * Walk a dotted path on `target`. Returns `undefined` when any segment
 * doesn't exist. Treats `null` as a terminal (doesn't try to recurse on it).
 */
function getPath(target: unknown, path: string): unknown {
  if (path === '' || target === null || target === undefined) return undefined;
  let cursor: unknown = target;
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Evaluate a `Condition` against `target`. Total — never throws on shape. */
export function evaluate(condition: Condition, target: unknown): boolean {
  if (isAllCondition(condition)) {
    return condition.all.every((c) => evaluate(c, target));
  }
  if (isAnyCondition(condition)) {
    return condition.any.some((c) => evaluate(c, target));
  }
  if (isNotCondition(condition)) {
    return !evaluate(condition.not, target);
  }
  if (isFieldCondition(condition)) {
    return evaluateField(condition, target);
  }
  // Unknown shape — fail closed. Hosts MUST validate via `validateCondition`
  // before persisting; an unknown shape here usually means a hand-edited
  // record or a version skew.
  return false;
}

function evaluateField(c: FieldCondition, target: unknown): boolean {
  const lhs = getPath(target, c.field);
  const rhs = c.value;

  switch (c.op) {
    case 'eq':
      return strictEqual(lhs, rhs);
    case 'neq':
      return !strictEqual(lhs, rhs);
    case 'gt':
      return compare(lhs, rhs) > 0;
    case 'gte':
      return compare(lhs, rhs) >= 0;
    case 'lt':
      return compare(lhs, rhs) < 0;
    case 'lte':
      return compare(lhs, rhs) <= 0;
    case 'in':
      return Array.isArray(rhs) && rhs.some((v) => strictEqual(lhs, v));
    case 'nin':
      return Array.isArray(rhs) && !rhs.some((v) => strictEqual(lhs, v));
    case 'contains':
      return Array.isArray(lhs) && lhs.some((v) => strictEqual(v, rhs));
    case 'startsWith':
      return typeof lhs === 'string' && typeof rhs === 'string' && lhs.startsWith(rhs);
    case 'endsWith':
      return typeof lhs === 'string' && typeof rhs === 'string' && lhs.endsWith(rhs);
    case 'isNull':
      return lhs === null || lhs === undefined;
    case 'isNotNull':
      return lhs !== null && lhs !== undefined;
    default:
      // Unreachable: `Comparator` is a closed union and every variant is
      // handled above. If we ever extend `Comparator`, TS exhaustiveness
      // will fail at the IIFE boundary because the new variant can't
      // satisfy `never`.
      return ((_: never): boolean => false)(c.op);
  }
}

/**
 * Equality with `Date` awareness. `===` on two `Date` objects with the same
 * millis returns `false`; this normalizes them. Plain primitives use `===`.
 */
function strictEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === 'string') return a.toISOString() === b;
  if (typeof a === 'string' && b instanceof Date) return a === b.toISOString();
  return a === b;
}

/**
 * Numeric / chronological comparison. Returns `NaN` (which `compare()`
 * callers handle by returning false for gt/lt/gte/lte) when operands aren't
 * comparable. Dates are compared by their unix timestamp.
 */
function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  if (typeof av === 'string' && typeof bv === 'string') {
    return av < bv ? -1 : av > bv ? 1 : 0;
  }
  return Number.NaN;
}

// ─── Validation ───────────────────────────────────────────────────────────

export type ConditionErrorCode =
  | 'EMPTY'
  | 'UNKNOWN_SHAPE'
  | 'INVALID_OP'
  | 'MISSING_VALUE'
  | 'EMPTY_GROUP';

export class ConditionError extends Error {
  override readonly name = 'ConditionError';
  readonly code: ConditionErrorCode;
  constructor(code: ConditionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const COMPARATORS = new Set<Comparator>([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'in', 'nin', 'contains', 'startsWith', 'endsWith',
  'isNull', 'isNotNull',
]);
const UNARY_OPS = new Set<Comparator>(['isNull', 'isNotNull']);

/**
 * Validate a condition shape before persisting. Recurses through composites.
 * Throws `ConditionError` so hosts get a stable code + message in API
 * responses (`{ code: 'INVALID_OP', message: '...' }`).
 */
export function validateCondition(condition: Condition): void {
  if (condition === null || typeof condition !== 'object') {
    throw new ConditionError('EMPTY', 'condition is null or not an object');
  }
  if (isAllCondition(condition)) {
    if (condition.all.length === 0) {
      throw new ConditionError('EMPTY_GROUP', 'all-group must have at least one branch');
    }
    condition.all.forEach(validateCondition);
    return;
  }
  if (isAnyCondition(condition)) {
    if (condition.any.length === 0) {
      throw new ConditionError('EMPTY_GROUP', 'any-group must have at least one branch');
    }
    condition.any.forEach(validateCondition);
    return;
  }
  if (isNotCondition(condition)) {
    validateCondition(condition.not);
    return;
  }
  if (isFieldCondition(condition)) {
    if (!COMPARATORS.has(condition.op)) {
      throw new ConditionError(
        'INVALID_OP',
        `unknown comparator: ${JSON.stringify(condition.op)}`,
      );
    }
    if (!UNARY_OPS.has(condition.op) && condition.value === undefined) {
      throw new ConditionError(
        'MISSING_VALUE',
        `comparator '${condition.op}' requires a value`,
      );
    }
    return;
  }
  throw new ConditionError(
    'UNKNOWN_SHAPE',
    `condition must be a field/all/any/not — got: ${JSON.stringify(condition)}`,
  );
}
