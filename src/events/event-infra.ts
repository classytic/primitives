/**
 * In-process event infrastructure — the dependency-free reference RUNTIME
 * that every kernel defaults to when the host injects no `eventTransport` /
 * outbox store.
 *
 * Placement rationale (0.13.0): `/events` and `/outbox` stay contract-only
 * (primitives owns pure cross-package contracts; arc owns the DURABLE
 * runtime — `EventOutbox` relay, `MongoOutboxStore`, backoff, Fastify
 * integration). But every kernel also needs an in-process default bus and a
 * memory outbox for tests/dev, and kernels cannot dep arc — so before this
 * module existed each kernel carried its own ~60-line copy (26 drifted
 * `in-process-bus.ts` copies, 15 `outbox-store.ts` copies across
 * commerce/packages). This subpath is the single shared implementation.
 * Kernels keep their public class names as thin subclasses:
 *
 * ```ts
 * export class InProcessPurchaseBus extends InProcessEventBus {
 *   constructor(options: InProcessEventBusOptions = {}) {
 *     super({ name: 'in-process-purchase', logLabel: 'purchase', ...options });
 *   }
 * }
 * ```
 */

import type {
  DomainEvent,
  EventHandler,
  EventTransport,
  PublishManyResult,
} from './events.js';
import { matchEventPattern } from './events.js';
import type {
  OutboxAcknowledgeOptions,
  OutboxStore,
  OutboxWriteOptions,
} from './outbox.js';

/** Minimal error-only logger — assignable from `console`, pino, fastify.log. */
export interface ErrorLogger {
  error(message: string, ...args: unknown[]): void;
}

export interface InProcessEventBusOptions {
  /**
   * Transport name (`EventTransport.name`). Kernels use
   * `'in-process-<kernel>'`. Default: `'in-process'`.
   */
  name?: string;

  /**
   * Logger for per-handler error isolation (default: `console`).
   * Pass `null` to swallow handler errors silently (cart's historical
   * behavior — event emission never propagates OR logs).
   */
  logger?: ErrorLogger | null;

  /**
   * Label used in the handler-error log line:
   * `[<logLabel>] handler error for <event.type>:`. Default: `name`.
   */
  logLabel?: string;
}

/**
 * In-process fan-out `EventTransport` — structurally identical to arc's
 * `MemoryEventTransport`, so the two are interchangeable.
 *
 * Semantics (the union of every kernel copy this replaces):
 *  - Glob matching via {@link matchEventPattern} (exact / `*` / `prefix.*`
 *    / `prefix:*`).
 *  - A handler subscribed under multiple matching patterns fires ONCE per
 *    event (Set-dedup — the majority variant across kernels).
 *  - Per-handler error isolation: one failing subscriber never crashes
 *    siblings; the failure is logged (or swallowed with `logger: null`).
 *  - `publishMany` batches per-event outcomes keyed by `meta.id`.
 *  - `close()` clears all subscriptions; publish after close is a no-op;
 *    close is idempotent. NOT durable — engines own it under the fleet
 *    `ownsBus` convention (PACKAGE_RULES §8.1).
 */
export class InProcessEventBus implements EventTransport {
  readonly name: string;
  private handlers = new Map<string, Set<EventHandler>>();
  private readonly logger: ErrorLogger | null;
  private readonly logLabel: string;

  constructor(options: InProcessEventBusOptions = {}) {
    this.name = options.name ?? 'in-process';
    this.logger = options.logger === null ? null : (options.logger ?? console);
    this.logLabel = options.logLabel ?? this.name;
  }

  async publish(event: DomainEvent): Promise<void> {
    const matched = new Set<EventHandler>();
    for (const [pattern, set] of this.handlers.entries()) {
      if (matchEventPattern(pattern, event.type)) {
        for (const h of set) matched.add(h);
      }
    }
    for (const handler of matched) {
      try {
        await handler(event);
      } catch (err) {
        this.logger?.error(`[${this.logLabel}] handler error for ${event.type}:`, err);
      }
    }
  }

  async publishMany(events: readonly DomainEvent[]): Promise<PublishManyResult> {
    const results = new Map<string, Error | null>();
    for (const event of events) {
      try {
        await this.publish(event);
        results.set(event.meta.id, null);
      } catch (err) {
        results.set(event.meta.id, err instanceof Error ? err : new Error(String(err)));
      }
    }
    return results;
  }

  async subscribe(pattern: string, handler: EventHandler): Promise<() => void> {
    let set = this.handlers.get(pattern);
    if (!set) {
      set = new Set();
      this.handlers.set(pattern, set);
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(pattern);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this.handlers.delete(pattern);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}

/** Factory form of {@link InProcessEventBus} for hosts that prefer functions. */
export function createInProcessBus(options?: InProcessEventBusOptions): InProcessEventBus {
  return new InProcessEventBus(options);
}

/**
 * In-memory {@link OutboxStore} for tests and local dev. Not for production —
 * hosts wire arc's `MongoOutboxStore`, a mongokit repo via
 * `repositoryAsOutboxStore`, or any durable implementation.
 *
 * Implements the required trio (`save` / `getPending` / `acknowledge`) plus
 * optional `purge`. Lease-based methods (`claimPending` / `fail` /
 * `getDeadLettered`) are intentionally omitted — single-process tests don't
 * need them, and kernels only call `save()` themselves. `all()` / `clear()`
 * are test-inspection helpers (not part of the contract).
 */
export class MemoryOutboxStore implements OutboxStore {
  private events: Array<{ event: DomainEvent; acknowledgedAt?: Date }> = [];

  async save(event: DomainEvent, _options?: OutboxWriteOptions): Promise<void> {
    this.events.push({ event });
  }

  async getPending(limit: number): Promise<DomainEvent[]> {
    return this.events
      .filter((e) => !e.acknowledgedAt)
      .slice(0, limit)
      .map((e) => e.event);
  }

  async acknowledge(eventId: string, _options?: OutboxAcknowledgeOptions): Promise<void> {
    const entry = this.events.find((e) => e.event.meta.id === eventId);
    if (entry) entry.acknowledgedAt = new Date();
  }

  async purge(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    const before = this.events.length;
    this.events = this.events.filter(
      (e) => !e.acknowledgedAt || e.acknowledgedAt.getTime() >= cutoff,
    );
    return before - this.events.length;
  }

  /** Every saved event (acknowledged or not) — test inspection helper. */
  all(): ReadonlyArray<DomainEvent> {
    return this.events.map((e) => e.event);
  }

  /** Reset the store — test helper. */
  clear(): void {
    this.events = [];
  }
}
