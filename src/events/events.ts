/**
 * Domain event transport primitives.
 *
 * These shapes MIRROR `@classytic/arc`'s event types verbatim. Arc owns the
 * contract — primitives tracks. Keep this file bit-identical to
 * `packages/reference-only/arc/src/events/EventTransport.ts` for `EventMeta`,
 * `DomainEvent`, `EventTransport`, `DeadLetteredEvent`, and
 * `PublishManyResult`. Helpers (`createEvent`, `createChildEvent`) are
 * allowed to be more defensive (e.g. fall back when `crypto.randomUUID` is
 * unavailable) but their signatures must match arc.
 *
 * Packages declare these from primitives (instead of importing arc) so they
 * remain runtime-independent of arc while still plugging into any arc
 * `EventTransport` without adapters. See PACKAGE_RULES.md §11.
 */

/**
 * Event metadata.
 *
 * Mirrored from arc v2.9. Any consumer using `@classytic/arc`'s `EventMeta`
 * type gets a structural match with primitives' `EventMeta` and vice-versa.
 */
export interface EventMeta {
  /** Unique event identifier — UUID v4 recommended. */
  id: string;

  /** Emit timestamp. */
  timestamp: Date;

  /**
   * Schema version for this event type. Default: `1`.
   *
   * Use when the payload shape evolves so handlers can branch on version
   * during migration windows (`if (event.meta.schemaVersion === 2) ...`).
   * Bump ONLY when the payload contract changes in a breaking way.
   */
  schemaVersion?: number;

  /**
   * Correlation ID — stays stable across an entire causal chain so a single
   * user action can be traced through every downstream event. Spans service
   * boundaries. Generated at the edge (HTTP request, CLI invocation) and
   * inherited by every child event.
   *
   * Distinct from {@link causationId}: **correlation groups, causation chains.**
   */
  correlationId?: string;

  /**
   * Causation ID — the `meta.id` of the direct parent event that caused
   * this one. Forms a linked-list of cause-and-effect within a correlation.
   *
   * Use {@link createChildEvent} to populate this automatically so handlers
   * can't forget to propagate causality.
   */
  causationId?: string;

  /**
   * Partition key hint for ordered transports (Kafka, Kinesis, Redis Streams
   * consumer groups). Events with the same partitionKey are guaranteed to be
   * delivered in publish order by transports that honour it.
   *
   * Defaults to `resourceId` if unset. Transports that don't support ordering
   * (in-memory, simple pub/sub) ignore this field.
   */
  partitionKey?: string;

  /** Source resource name — e.g. 'order', 'transaction'. */
  resource?: string;

  /** Resource identifier — typically the document's public id. */
  resourceId?: string;

  /** User who triggered the event. */
  userId?: string;

  /** Organization / tenant scope. */
  organizationId?: string;

  /**
   * Originating service or package (e.g. `'commerce'`, `'billing'`, `'arc-core'`).
   *
   * In a multi-service deployment, consumers route / log / alert by `source`
   * without parsing `type` prefixes. Arc itself never populates this — hosts
   * set it once per emitter. Inherited by {@link createChildEvent} so
   * downstream events carry the same source unless overridden.
   */
  source?: string;

  /**
   * Idempotency key — stable hint that this event represents a specific
   * operation exactly once. Consumers dedupe with
   * `if (processed.has(meta.idempotencyKey)) return`.
   *
   * Survives every transport (Memory / Pub-Sub / Streams / Kafka) because
   * it's part of the event, not a transport-side option. Distinct from
   * `meta.id` (which is fresh per emit — a retry would produce a new id).
   *
   * Typical sources: HTTP `Idempotency-Key` header, outbox `dedupeKey`, or
   * `{aggregate.type}:{aggregate.id}:{action}`. Inherited by child events.
   */
  idempotencyKey?: string;

  /**
   * DDD aggregate marker — the aggregate that owns this event's invariant.
   *
   * Use when routing events by aggregate, doing event-sourcing replay, or
   * enforcing consistency boundaries. Distinct from `resource` / `resourceId`
   * (HTTP-origin entity) because an event emitted *by* one REST resource can
   * *belong to* a different aggregate (e.g. `POST /orders/:id/ship` emits
   * `shipment.dispatched` owned by a shipment aggregate).
   *
   * Downstream packages narrow `aggregate.type` to their own string union via
   * interface extension:
   *
   * ```ts
   * type CartAggregateType = 'cart' | 'cart-item';
   * interface CartEventMeta extends EventMeta {
   *   aggregate?: { type: CartAggregateType; id: string };
   * }
   * ```
   *
   * Not inherited by {@link createChildEvent} — child events typically belong
   * to a different aggregate than their parent.
   */
  aggregate?: { type: string; id: string };
}

export interface DomainEvent<T = unknown> {
  /** Dotted / colon-separated event name — e.g. 'order:placed'. */
  type: string;
  payload: T;
  meta: EventMeta;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => void | Promise<void>;

/**
 * A permanently-failed event routed to a dead-letter sink after retries
 * have been exhausted. Mirrors the shape a caller would log, alert on, or
 * replay from once the upstream issue is fixed.
 */
export interface DeadLetteredEvent<T = unknown> {
  /** The original event. */
  event: DomainEvent<T>;
  /** Serialised failure reason (message + optional machine code + stack). */
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
  /** How many delivery attempts were made before giving up. */
  attempts: number;
  /** First failure timestamp. */
  firstFailedAt: Date;
  /** Last failure timestamp (immediately before dead-lettering). */
  lastFailedAt: Date;
  /** Optional handler / subscriber name that last failed (for debug). */
  handlerName?: string;
}

/**
 * Minimal logger interface for event transports. Compatible with `console`,
 * `pino`, `fastify.log`, and any custom logger. Mirrors arc's `EventLogger`.
 */
export interface EventLogger {
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Per-event publish outcome keyed by `meta.id`. `null` entry = success,
 * `Error` = failure for that specific event. Matches arc's `publishMany`
 * return contract.
 */
export type PublishManyResult = ReadonlyMap<string, Error | null>;

/**
 * Transport contract. Any object matching this shape — arc's
 * `MemoryEventTransport`, a Redis-backed transport, a Kafka publisher, or an
 * in-process bus — can be passed into a Classytic package as
 * `config.eventTransport`.
 */
export interface EventTransport {
  readonly name: string;

  publish(event: DomainEvent): Promise<void>;

  /**
   * Publish a batch of events in one round-trip (optional). Arc v2.8.1+
   * transports implement this; outbox relays auto-detect it for higher
   * throughput. Consumers must fall back to per-event `publish()` when
   * absent.
   */
  publishMany?(events: readonly DomainEvent[]): Promise<PublishManyResult>;

  /**
   * Subscribe to a glob pattern — exact match, `*`, or `resource.*`. Returns
   * an unsubscribe function.
   *
   * Optional (0.13.0): publish-only transports — outbox bridge adapters,
   * host wrappers around a `publish(type, payload, meta)` helper, fire-and-
   * forget pipes into Kafka/webhooks — are legitimate `EventTransport`s.
   * Consumers that need in-process delivery MUST guard (`transport.subscribe
   * ? … : throw/fallback`) the same way they already do for the optional
   * `publishMany` / `deadLetter` members (see flow's
   * `ConsignmentService.createSettlementListener` for the reference guard).
   * Kernels subscribing on their OWN in-process bus (which always implements
   * `subscribe`) are unaffected.
   */
  subscribe?(pattern: string, handler: EventHandler): Promise<() => void>;

  /**
   * Route a permanently-failed event to the transport's dead-letter sink
   * (Kafka DLQ topic, SQS DLQ, Redis Stream `PEL` timeout handler, etc.).
   *
   * Called by outbox relays after exhausting retries. Transports that don't
   * have a native DLQ can omit this — callers treat an absent `deadLetter`
   * as "log and drop".
   */
  deadLetter?(dlq: DeadLetteredEvent): Promise<void>;

  close?(): Promise<void>;
}

/**
 * Build a {@link DomainEvent} with auto-filled `id` + `timestamp`. All other
 * `EventMeta` fields are caller-controlled and override the defaults if
 * supplied (same semantics as arc's `createEvent`).
 */
export function createEvent<T>(
  type: string,
  payload: T,
  meta?: Partial<EventMeta>,
): DomainEvent<T> {
  return {
    type,
    payload,
    meta: {
      id: randomEventId(),
      timestamp: new Date(),
      ...meta,
    },
  };
}

/**
 * Create a child event that chains causation from a parent event.
 *
 * Rules (mirrored from arc v2.9):
 *  - `causationId` is set to the parent's `id` (direct cause)
 *  - `correlationId` is inherited from the parent if set, else falls back
 *    to the parent's `id` (root correlation)
 *  - `userId` / `organizationId` / `source` / `idempotencyKey` are inherited
 *    when set on the parent so the whole chain stays scoped to the
 *    originating principal, tenant, emitter, and logical operation
 *  - `aggregate` is NOT inherited — child events typically belong to a
 *    different aggregate than their parent
 *
 * Caller-supplied `meta` wins over inherited fields — pass `{ userId: newActor }`
 * to override when a subsystem acts on behalf of a different principal.
 *
 * @example
 * const orderPlaced = createEvent('order.placed', { orderId: 'o1' }, {
 *   correlationId: req.id, userId: user.id,
 * });
 *
 * const reserved = createChildEvent(orderPlaced, 'inventory.reserved', {
 *   orderId: 'o1', skus: ['sku-1', 'sku-2'],
 * });
 * // reserved.meta.causationId   === orderPlaced.meta.id
 * // reserved.meta.correlationId === orderPlaced.meta.correlationId
 * // reserved.meta.userId        === user.id   (inherited)
 */
export function createChildEvent<T>(
  parent: DomainEvent,
  type: string,
  payload: T,
  meta?: Partial<EventMeta>,
): DomainEvent<T> {
  const inherited: Partial<EventMeta> = {
    correlationId: parent.meta.correlationId ?? parent.meta.id,
    causationId: parent.meta.id,
  };
  if (parent.meta.userId !== undefined) inherited.userId = parent.meta.userId;
  if (parent.meta.organizationId !== undefined) {
    inherited.organizationId = parent.meta.organizationId;
  }
  if (parent.meta.source !== undefined) inherited.source = parent.meta.source;
  if (parent.meta.idempotencyKey !== undefined) {
    inherited.idempotencyKey = parent.meta.idempotencyKey;
  }
  // `aggregate` is NOT inherited — child events usually belong to a different
  // aggregate than their parent (see the DDD semantics in EventMeta docs).

  return {
    type,
    payload,
    meta: {
      id: randomEventId(),
      timestamp: new Date(),
      ...inherited,
      ...meta,
    },
  };
}

/**
 * The context slice {@link createScopedEvent} maps into {@link EventMeta}.
 *
 * Structurally satisfied by primitives' `OperationContext` (actorId /
 * organizationId as IdLike) AND by the commerce `actorRef` dialect used by
 * cart/promo/crm — so every kernel context threads straight through.
 */
export interface EventScopeContext {
  /** Authenticated principal id (`OperationContext.actorId` shape). */
  actorId?: string | number | { toString(): string } | undefined;
  /** Commerce actor-reference dialect (`user:123`, `guest:abc`). Used when `actorId` is absent. */
  actorRef?: string | undefined;
  /** Tenant / organization / branch scope — rides `meta.organizationId` (META, never payload). */
  organizationId?: string | { toString(): string } | undefined;
  /** Correlation id threaded across the causal chain. */
  correlationId?: string | undefined;
}

/**
 * Map an operation context onto event META — THE standard context→meta
 * mapping (PACKAGE_RULES §8.3: `organizationId` rides META). Extracted from
 * 25 drifted per-kernel `events/helpers.ts` copies.
 *
 *  - `userId`  ← `String(ctx.actorId)`, falling back to `ctx.actorRef`
 *  - `organizationId` ← `String(ctx.organizationId)`
 *  - `correlationId`  ← `ctx.correlationId`
 *
 * Absent fields are OMITTED (not set to `undefined`) so the result spreads
 * cleanly under `exactOptionalPropertyTypes`.
 */
export function scopedEventMeta(ctx?: EventScopeContext): Partial<EventMeta> {
  if (!ctx) return {};
  const meta: Partial<EventMeta> = {};
  const actor = ctx.actorId ?? ctx.actorRef;
  if (actor !== undefined) meta.userId = String(actor);
  if (ctx.organizationId !== undefined) meta.organizationId = String(ctx.organizationId);
  if (ctx.correlationId !== undefined) meta.correlationId = ctx.correlationId;
  return meta;
}

/**
 * Build a {@link DomainEvent} scoped to an emitting package and an operation
 * context — the shared core behind every kernel's `createXEvent` helper.
 *
 * ```ts
 * // purchase/src/events/helpers.ts becomes:
 * export const createPurchaseEvent = <T>(type, payload, ctx?, meta?) =>
 *   createScopedEvent('@classytic/purchase', type, payload, ctx, meta);
 * ```
 *
 * Precedence: defaults (id/timestamp) < `source` < context mapping < caller
 * `meta` — identical to the hand-rolled helpers this replaces.
 */
export function createScopedEvent<T>(
  source: string,
  type: string,
  payload: T,
  ctx?: EventScopeContext,
  meta?: Partial<EventMeta>,
): DomainEvent<T> {
  return createEvent(type, payload, { source, ...scopedEventMeta(ctx), ...meta });
}

/**
 * Match an event name against a glob pattern. Implements the same rules as
 * arc's `MemoryEventTransport`:
 *   - `*` matches anything
 *   - `prefix.*` matches anything starting with `prefix.`
 *   - `prefix:*` matches anything starting with `prefix:` (Classytic convention)
 *   - exact match otherwise
 */
export function matchEventPattern(pattern: string, type: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  if (pattern.endsWith(':*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

/** Minimal UUID-v4-style identifier. Uses `crypto.randomUUID` when available. */
function randomEventId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // RFC 4122 v4 fallback — only hit on very old runtimes without Web Crypto.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
