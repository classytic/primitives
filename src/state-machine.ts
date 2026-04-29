/**
 * Declarative state-machine primitive.
 *
 * Replaces hand-rolled `if (status === 'X') throw` blocks scattered
 * across domain services. Each aggregate declares one transition table;
 * the helper provides `canTransition` / `assertTransition` / `isTerminal`
 * accessors that the services share.
 *
 * Generic over the status string-union so calls stay type-safe:
 *   `defineStateMachine<ProcurementStatus>({ name: 'ProcurementOrder', transitions: { … } })`
 * The TS compiler enforces exhaustiveness — every status string in the
 * union MUST have an entry in `transitions` (terminal statuses map to `[]`).
 *
 * @example
 * import { defineStateMachine } from '@classytic/primitives/state-machine';
 *
 * type OrderStatus = 'draft' | 'approved' | 'shipped' | 'cancelled';
 * const ORDER_MACHINE = defineStateMachine<OrderStatus>({
 *   name: 'Order',
 *   transitions: {
 *     draft: ['approved', 'cancelled'],
 *     approved: ['shipped', 'cancelled'],
 *     shipped: [],
 *     cancelled: [],
 *   },
 * });
 *
 * ORDER_MACHINE.assertTransition('order-1', 'draft', 'approved'); // OK
 * ORDER_MACHINE.assertTransition('order-1', 'shipped', 'draft');  // throws
 * ORDER_MACHINE.canTransition('draft', 'shipped');                // false
 * ORDER_MACHINE.isTerminal('shipped');                            // true
 *
 * Hosts that already have their own typed transition error can swap it
 * in via `errorFactory`:
 *
 * @example
 * import { InvalidTransitionError } from './errors.js';
 * const FLOW_MACHINE = defineStateMachine<MoveStatus>({
 *   name: 'StockMove',
 *   transitions: { … },
 *   errorFactory: ({ entityType, entityId, from, to }) =>
 *     new InvalidTransitionError(entityType, entityId, from, to),
 * });
 */

/**
 * Default error thrown by `assertTransition` when no `errorFactory` is
 * supplied. Carries the structured fields (`entityType`, `entityId`,
 * `from`, `to`) plus a stable `code` so hosts can pattern-match on
 * either `instanceof` or `error.code === 'illegal_transition'`.
 */
export class IllegalTransitionError extends Error {
  readonly code = 'illegal_transition' as const;
  readonly status = 422;
  readonly entityType: string;
  readonly entityId: string;
  readonly from: string;
  readonly to: string;

  constructor(entityType: string, entityId: string, from: string, to: string) {
    super(`Invalid transition for ${entityType} ${entityId}: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
    this.entityType = entityType;
    this.entityId = entityId;
    this.from = from;
    this.to = to;
  }
}

export interface TransitionErrorContext {
  readonly entityType: string;
  readonly entityId: string;
  readonly from: string;
  readonly to: string;
}

export interface StateMachineDefinition<TStatus extends string> {
  /** Aggregate name surfaced in the thrown error's `entityType`. */
  name: string;
  /**
   * Adjacency list — for each status, the set of statuses you can
   * legally transition TO. Terminal statuses map to an empty array.
   * `Record<TStatus, …>` enforces exhaustiveness at the call site.
   */
  transitions: Record<TStatus, readonly TStatus[]>;
  /**
   * Optional custom error factory. When omitted, `assertTransition`
   * throws `IllegalTransitionError`. Hosts that own a domain error
   * (e.g. flow's `InvalidTransitionError`) wire their own here so the
   * thrown type stays consistent with the rest of the package.
   */
  errorFactory?: (ctx: TransitionErrorContext) => Error;
}

export interface StateMachine<TStatus extends string> {
  /** The aggregate name (`StockMove`, `ProcurementOrder`, etc.). */
  readonly name: string;
  /** All terminal statuses (no outgoing transitions). */
  readonly terminal: ReadonlySet<TStatus>;
  /** True when `from → to` is in the transition table. */
  canTransition(from: TStatus, to: TStatus): boolean;
  /** True when `status` is terminal. */
  isTerminal(status: TStatus): boolean;
  /**
   * Throw a transition error when `from → to` isn't allowed.
   * `entityId` is included in the error for traceability.
   */
  assertTransition(entityId: string, from: TStatus, to: TStatus): void;
  /** The raw transition table — exposed read-only for advanced callers. */
  readonly transitions: Readonly<Record<TStatus, readonly TStatus[]>>;
}

export function defineStateMachine<TStatus extends string>(
  definition: StateMachineDefinition<TStatus>,
): StateMachine<TStatus> {
  const { name, transitions, errorFactory } = definition;

  // Pre-compute terminal statuses (those with empty outgoing list).
  const terminal = new Set<TStatus>();
  for (const [status, allowed] of Object.entries(transitions) as [
    TStatus,
    readonly TStatus[],
  ][]) {
    if (allowed.length === 0) terminal.add(status);
  }

  const buildError = errorFactory
    ? errorFactory
    : (ctx: TransitionErrorContext) =>
        new IllegalTransitionError(ctx.entityType, ctx.entityId, ctx.from, ctx.to);

  return {
    name,
    terminal,
    transitions,
    canTransition(from, to) {
      const allowed = transitions[from];
      return allowed?.includes(to) ?? false;
    },
    isTerminal(status) {
      return terminal.has(status);
    },
    assertTransition(entityId, from, to) {
      const allowed = transitions[from];
      if (!allowed?.includes(to)) {
        throw buildError({ entityType: name, entityId, from, to });
      }
    },
  };
}
