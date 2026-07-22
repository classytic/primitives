/**
 * Transactional outbox contract — **this file is the canonical owner**
 * (0.13.0+). `@classytic/arc` imports and re-exports this contract; it no
 * longer maintains its own copy.
 *
 * Ownership rule (settled 2026-07): primitives owns pure cross-package
 * CONTRACTS (events + outbox); arc owns the DURABLE runtime — the
 * `EventOutbox` relay, `MongoOutboxStore`, `repositoryAsOutboxStore`,
 * `exponentialBackoff`, and Fastify integration all live in
 * `@classytic/arc/events`. The dependency-free in-process REFERENCE runtime
 * (default kernel bus + `MemoryOutboxStore` for tests/dev) lives in
 * `@classytic/primitives/event-infra` — kernels can't dep arc, so the
 * shared fallback implementation lives here instead of being copy-pasted
 * per kernel.
 *
 * This module defines the contract surface only:
 *
 *   - {@link OutboxStore} — persistence interface every store implements
 *   - Option types for `save` / `claimPending` / `acknowledge` / `fail`
 *   - {@link OutboxFailurePolicy} contract for retry / DLQ decisions
 *   - Error classes: {@link OutboxOwnershipError}, {@link InvalidOutboxEventError}
 *
 * Why the split:
 *
 *   Domain packages (cart, ledger, invoice, …) declare outbox stores
 *   (`CartOutboxRepository`, etc.) that implement this contract, so hosts
 *   can drop them straight into arc's `new EventOutbox({ store: cartOutbox })`.
 *   Packages MUST NOT peer-dep arc; they peer-dep primitives. Owning the
 *   contract here lets packages write `implements OutboxStore` without
 *   pulling arc into their dependency graph — and because arc re-exports
 *   these exact classes, `instanceof OutboxOwnershipError` works across the
 *   package boundary (arc's relay catches errors thrown by package stores).
 */

import type { DeadLetteredEvent, DomainEvent } from './events.js';

// ============================================================================
// Option Types
// ============================================================================

/**
 * Options passed to {@link OutboxStore.save} for richer write semantics.
 * Stores may ignore fields they don't support — contract is best-effort.
 */
export interface OutboxWriteOptions {
  /**
   * Host-provided DB session/transaction handle for atomic writes. Typed as
   * `unknown` so stores can accept any backend (mongoose session, pg client,
   * Prisma tx, etc.) without primitives taking a peer dep.
   */
  readonly session?: unknown;

  /** Earliest time the event should be visible to relay workers (for delayed publishing). */
  readonly visibleAt?: Date;

  /** Idempotency key — stores that support it should dedupe on this. */
  readonly dedupeKey?: string;

  /** Partition / routing key for sharded transports (Kafka, Redis Streams). */
  readonly partitionKey?: string;

  /** Arbitrary headers propagated to the transport layer. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Options for {@link OutboxStore.claimPending} — lease-based work claim.
 * Supports safe multi-worker relay: each worker atomically claims a batch
 * with a lease TTL, preventing duplicate publishes.
 */
export interface OutboxClaimOptions {
  /** Max events to claim. */
  readonly limit?: number;

  /** Unique identifier for the claiming worker. */
  readonly consumerId?: string;

  /** Lease duration in ms — claim is released automatically after this. */
  readonly leaseMs?: number;

  /** Only claim events of these types (optional filter). */
  readonly types?: readonly string[];
}

/** Options for {@link OutboxStore.acknowledge}. */
export interface OutboxAcknowledgeOptions {
  /** Worker identifier — stores may enforce "only owner can ack". */
  readonly consumerId?: string;
}

/** Options for {@link OutboxStore.fail}. */
export interface OutboxFailOptions {
  /** Worker identifier — stores may enforce "only owner can fail". */
  readonly consumerId?: string;

  /** Schedule retry for a later time (implements backoff). */
  readonly retryAt?: Date;

  /** Move the event to dead-letter state (no further retries). */
  readonly deadLetter?: boolean;
}

/** Normalized error info passed to {@link OutboxStore.fail}. */
export interface OutboxErrorInfo {
  readonly message: string;
  readonly code?: string;
}

// ============================================================================
// Failure policy
// ============================================================================

/** Context passed to {@link OutboxFailurePolicy}. */
export interface OutboxFailureContext {
  /** The event whose delivery just failed. */
  readonly event: DomainEvent;

  /** The error returned by the transport / handler. */
  readonly error: Error;

  /**
   * Attempt count including this failure (1 on the first fail). Tracked
   * in-process by the relay; accurate within a single relay process, resets
   * on restart. For durable attempt counts, the policy can query the store.
   */
  readonly attempts: number;
}

/**
 * Decision returned by {@link OutboxFailurePolicy} — controls how the relay
 * calls `store.fail()` for a failed event.
 */
export interface OutboxFailureDecision {
  /** Schedule retry for this time. Omit for immediate (next-poll) retry. */
  readonly retryAt?: Date;

  /** Move the event to dead-letter state (no further retries). */
  readonly deadLetter?: boolean;
}

/**
 * Centralised retry/DLQ policy evaluated by the arc relay on every failure.
 * Returns the options passed to `store.fail()`.
 *
 * ```ts
 * failurePolicy: ({ attempts }) => {
 *   if (attempts >= 5) return { deadLetter: true };
 *   return { retryAt: exponentialBackoff({ attempt: attempts }) };
 * }
 * ```
 */
export type OutboxFailurePolicy = (
  ctx: OutboxFailureContext,
) => OutboxFailureDecision | Promise<OutboxFailureDecision>;

// ============================================================================
// Error classes
// ============================================================================

/**
 * Thrown by a store when `acknowledge` / `fail` is called by a consumer that
 * does not own the event's current lease.
 *
 * Stores that enforce lease ownership MUST throw this (not silently return)
 * so the relay can detect the mismatch and avoid over-counting successful
 * deliveries.
 */
export class OutboxOwnershipError extends Error {
  override readonly name = 'OutboxOwnershipError';
  readonly eventId: string;
  readonly attemptedBy: string;
  readonly currentOwner: string | null;

  constructor(eventId: string, attemptedBy: string, currentOwner: string | null) {
    super(
      `Outbox ownership mismatch for event "${eventId}": attempted by "${attemptedBy}", current owner is "${currentOwner ?? 'none'}". ` +
        'The lease may have expired and been reclaimed by another worker.',
    );
    this.eventId = eventId;
    this.attemptedBy = attemptedBy;
    this.currentOwner = currentOwner;
  }
}

/** Thrown when an event missing `type` or `meta.id` is passed to the outbox. */
export class InvalidOutboxEventError extends Error {
  override readonly name = 'InvalidOutboxEventError';

  constructor(reason: string) {
    super(`Invalid outbox event: ${reason}`);
  }
}

// ============================================================================
// Outbox Store Interface
// ============================================================================

/**
 * Durable storage contract for the transactional outbox pattern.
 *
 * **Required methods**: `save`, `getPending`, `acknowledge`.
 *
 * **Optional capabilities** — stores opt-in to richer semantics:
 *
 *   - `claimPending` — lease-based work claim for multi-worker relay
 *   - `fail` — failure tracking with retry scheduling and dead-letter
 *   - `getDeadLettered` — typed DLQ replay surface
 *   - `purge` — acknowledged event cleanup
 *
 * Arc's runtime detects capabilities at runtime and degrades gracefully for
 * legacy stores that only implement the required methods.
 *
 * ## Required semantics
 *
 * Implementations MUST honor these contracts — arc's relay depends on them
 * for correctness of at-least-once delivery:
 *
 * 1. **`save` must reject invalid events.** If `event.type` or `event.meta.id`
 *    is missing/empty, throw — do not persist. Callers pre-validate but
 *    stores should defend against direct-save code paths.
 *
 * 2. **`claimPending` must be atomic.** Two workers calling `claimPending`
 *    concurrently must never receive the same event. SQL: `SELECT ... FOR
 *    UPDATE SKIP LOCKED`; Mongo: `findOneAndUpdate` with `{ leaseOwner:
 *    null }` in the match condition.
 *
 * 3. **`acknowledge` / `fail` must throw {@link OutboxOwnershipError} on
 *    ownership mismatch.** When `options.consumerId` is provided and does
 *    not match the current lease owner, throw — never silently no-op. The
 *    relay relies on this signal to avoid counting hijacked events as
 *    successfully relayed.
 *
 * 4. **`acknowledge` on an unknown `eventId` is a no-op.** Keeps the relay
 *    idempotent when the store has been purged or the event was manually
 *    removed. Do NOT throw `OutboxOwnershipError` in this case.
 *
 * 5. **`fail` must deterministically update lease/visibility.** On success,
 *    the event MUST become re-claimable (immediately or at `retryAt`) or
 *    transition to dead-letter. Lease owner should be cleared.
 *
 * 6. **Malformed events must never be returned by `getPending` /
 *    `claimPending`.** If the underlying storage has corrupt rows, the
 *    store is responsible for quarantining them.
 */
export interface OutboxStore {
  /**
   * Save an event to the outbox (typically called inside a business
   * transaction). MUST reject events missing `type` or `meta.id` — throw
   * rather than persist.
   */
  save(event: DomainEvent, options?: OutboxWriteOptions): Promise<void>;

  /**
   * Get pending (unrelayed) events, ordered FIFO. Multi-worker deployments
   * should prefer {@link OutboxStore.claimPending}. Events returned MUST be
   * well-formed (valid `type` and `meta.id`).
   */
  getPending(limit: number): Promise<DomainEvent[]>;

  /**
   * Atomically claim pending events with a lease. Two concurrent callers
   * must never receive overlapping events. When implemented, the relay
   * prefers this over `getPending`.
   */
  claimPending?(options?: OutboxClaimOptions): Promise<DomainEvent[]>;

  /**
   * Mark event as successfully relayed.
   *
   * **Ownership contract**: If `options.consumerId` is provided and does
   * not match the current lease owner, throw {@link OutboxOwnershipError}.
   * Unknown `eventId` is a no-op.
   *
   * @throws {@link OutboxOwnershipError} on ownership mismatch
   */
  acknowledge(eventId: string, options?: OutboxAcknowledgeOptions): Promise<void>;

  /**
   * Record a relay failure. When implemented, the relay calls this instead
   * of stopping the batch — enables retry scheduling and DLQ.
   *
   * **Ownership contract**: Same as `acknowledge` — throw
   * {@link OutboxOwnershipError} on mismatch. After a successful call the
   * lease owner MUST be cleared and the event MUST be re-claimable (at
   * `retryAt` if provided) or transitioned to dead-letter.
   *
   * @throws {@link OutboxOwnershipError} on ownership mismatch
   */
  fail?(eventId: string, error: OutboxErrorInfo, options?: OutboxFailOptions): Promise<void>;

  /**
   * Return events currently in dead-letter state as typed
   * {@link DeadLetteredEvent} envelopes. Closes the loop between
   * `fail({ deadLetter: true })` and the DLQ replay surface. MUST populate
   * `error`, `attempts`, `firstFailedAt`, `lastFailedAt` from whatever the
   * store tracked during `fail()` calls. `handlerName` is optional.
   */
  getDeadLettered?(limit: number): Promise<DeadLetteredEvent[]>;

  /**
   * Purge old **delivered** events. Scoped to `delivered` state only —
   * pending, failed, or dead-lettered events MUST NOT be removed.
   *
   * - MongoDB: typically done via TTL index on `deliveredAt` (zero-code).
   * - SQL: scheduled `DELETE WHERE status = 'delivered' AND delivered_at < :cutoff`.
   * - Redis: `EXPIRE` on delivered keys.
   *
   * @returns Number of purged events.
   */
  purge?(olderThanMs: number): Promise<number>;
}
