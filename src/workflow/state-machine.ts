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
  /**
   * Forward lookup — every status the aggregate can move TO from `from`.
   * Useful for UI dropdowns ("which actions are legal right now?") and
   * for fanning a single source state into a multi-source CAS via a
   * repo's `claim({ from: machine.validTargets(current), to })`.
   */
  validTargets(from: TStatus): readonly TStatus[];
  /**
   * Reverse lookup — every status that can transition INTO `to`. Pair
   * with a repo's multi-source `claim({ from: machine.validSources(to), to })`
   * when the target is fixed but the caller doesn't yet know the
   * current state (or wants to authorize ALL legal predecessors in one
   * round-trip).
   */
  validSources(to: TStatus): readonly TStatus[];
  /** The raw transition table — exposed read-only for advanced callers. */
  readonly transitions: Readonly<Record<TStatus, readonly TStatus[]>>;
}

export function defineStateMachine<TStatus extends string>(
  definition: StateMachineDefinition<TStatus>,
): StateMachine<TStatus> {
  const { name, transitions, errorFactory } = definition;

  // Pre-compute terminal statuses (those with empty outgoing list).
  const terminal = new Set<TStatus>();
  // Pre-compute the reverse adjacency map (`to → readonly TStatus[]`) so
  // `validSources` is O(1) lookup. Built once at definition time; the
  // `Object.freeze`ed arrays make the result safe to expose by reference.
  const reverse = new Map<TStatus, TStatus[]>();
  for (const [status, allowed] of Object.entries(transitions) as [
    TStatus,
    readonly TStatus[],
  ][]) {
    if (allowed.length === 0) terminal.add(status);
    for (const target of allowed) {
      const sources = reverse.get(target);
      if (sources) sources.push(status);
      else reverse.set(target, [status]);
    }
  }
  const frozenReverse = new Map<TStatus, readonly TStatus[]>();
  for (const [target, sources] of reverse) {
    frozenReverse.set(target, Object.freeze(sources.slice()) as readonly TStatus[]);
  }
  const EMPTY: readonly TStatus[] = Object.freeze([]) as readonly TStatus[];

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
    validTargets(from) {
      return transitions[from] ?? EMPTY;
    },
    validSources(to) {
      return frozenReverse.get(to) ?? EMPTY;
    },
  };
}

/**
 * Minimal structural type for any kit's `claim()` operation. Lets
 * `assertAndClaim` work against `@classytic/mongokit` (and future
 * sqlitekit / pgkit) without primitives taking a hard peer dep.
 *
 * Mirrors the mongokit 3.13 `Repository.claim()` signature with
 * `unknown`-typed values where the kit-specific shape (ObjectId, etc.)
 * doesn't concern the state-machine layer.
 */
export interface ClaimableRepo<TDoc> {
  claim(
    id: string,
    transition: {
      field?: string;
      from: unknown | readonly unknown[];
      to: unknown;
      where?: Record<string, unknown>;
    },
    patch?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<TDoc | null>;
}

/**
 * Pair a state-machine `assertTransition()` (sync domain check) with a
 * repo's `claim()` (runtime concurrency CAS) in one call. This is the
 * canonical state-machine-backed CAS pattern documented in mongokit
 * 3.13's CLAUDE.md.
 *
 *   - `assertTransition` rejects malformed transitions BEFORE we hit the
 *     database (compile-time-typed targets, sync, fast).
 *   - `claim` rejects concurrent writers AT the database (atomic
 *     CAS, returns `null` on race-loss).
 *
 * Skipping either layer leaves a hole: skip `assertTransition` and bad
 * transitions reach storage; skip `claim` and concurrent writers race.
 *
 * `from` accepts a single status OR an array of statuses (multi-source
 * CAS). When the array form is used, `assertTransition` is asserted for
 * EVERY listed source — a single illegal source aborts the call before
 * the round-trip.
 *
 * @example Single-source
 * ```ts
 * const updated = await assertAndClaim(WAVE_MACHINE, repo, waveId, {
 *   from: 'planned',
 *   to: 'released',
 *   patch: { releasedAt: new Date() },
 *   options: { organizationId: ctx.organizationId, session },
 * });
 * if (!updated) throw new ConcurrencyError(); // race-loss
 * ```
 *
 * @example Multi-source via `validSources`
 * ```ts
 * const updated = await assertAndClaim(WAVE_MACHINE, repo, waveId, {
 *   from: WAVE_MACHINE.validSources('cancelled'), // every legal predecessor
 *   to: 'cancelled',
 *   patch: { cancelledAt: new Date() },
 *   options: { organizationId: ctx.organizationId },
 * });
 * ```
 */
export async function assertAndClaim<TDoc, TStatus extends string>(
  machine: StateMachine<TStatus>,
  repo: ClaimableRepo<TDoc>,
  id: string,
  args: {
    from: TStatus | readonly TStatus[];
    to: TStatus;
    field?: string;
    patch?: Record<string, unknown>;
    where?: Record<string, unknown>;
    options?: Record<string, unknown>;
  },
): Promise<TDoc | null> {
  const sources = Array.isArray(args.from) ? args.from : [args.from as TStatus];
  for (const from of sources) {
    machine.assertTransition(id, from, args.to);
  }
  return repo.claim(
    id,
    {
      from: Array.isArray(args.from) ? (args.from as readonly TStatus[]) : (args.from as TStatus),
      to: args.to,
      ...(args.field !== undefined ? { field: args.field } : {}),
      ...(args.where !== undefined ? { where: args.where } : {}),
    },
    args.patch,
    args.options,
  );
}
