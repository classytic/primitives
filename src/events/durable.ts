/**
 * Durable events — the declaration a money or stock event carries, its deterministic id, and
 * the ONE dispatch every kernel emits through (outbox save in the unit of work, post-commit
 * delivery, acknowledge after an inline publish).
 *
 * A `durable` type may only be written as an outbox row in a unit of work, or as a child row of
 * a durable delivery; anything else throws {@link NonDurablePublishError}. Design:
 * `tasks/foundations/durable-events.md` in the commerce repo.
 */

import type { ErrorLogger } from './event-infra.js';
import type { DomainEvent, EventMeta, EventTransport } from './events.js';
import type { OutboxStore } from './outbox.js';

/** Required on every definition; no default, so neither side escapes by omission. */
export type EventDurability = 'ephemeral' | 'durable';

/**
 * A fact a durable event must eventually produce — attached at composition by its CONSUMER.
 * Members are methods so a typed definition stays assignable to an `unknown`-payload registry.
 */
export interface FactExpectation<P> {
  /** `'journal-entry'`, `'stock-move'`, … — matched to a mounted probe. */
  readonly kind: string;
  /** The consumer's own key function: the keys its fact rows carry for this event. */
  keys(payload: P, meta: EventMeta): readonly string[];
  readonly graceMinutes: number;
  /** `'unknown'` is a finding, never "does not apply". */
  applies?(payload: P): boolean | 'unknown';
}

export type DurableEventSpec<P> =
  | { readonly durability: 'ephemeral' }
  | {
      readonly durability: 'durable';
      /** Aggregate id plus step (`fulfillmentId`, `${paymentId}:captured`) — never the order alone. */
      occurrence(payload: P): string;
      readonly produces?: readonly FactExpectation<P>[];
    };

/** Where a publish happens. `deliveryOf` is the parent event id, set around a relayed delivery. */
export interface DurableContext {
  readonly session?: unknown;
  readonly outbox?: OutboxStore | undefined;
  readonly deliveryOf?: string | undefined;
}

export class NonDurablePublishError extends Error {
  override readonly name = 'NonDurablePublishError';
  readonly code = 'events.non_durable_publish';
  readonly eventType: string;

  constructor(eventType: string, reason: string) {
    super(`Durable event "${eventType}" cannot be published here: ${reason}.`);
    this.eventType = eventType;
  }
}

/** An open session with neither an outbox nor a post-commit queue: publishing leaks, dropping loses. */
export class UnmanagedSessionError extends Error {
  override readonly name = 'UnmanagedSessionError';
  readonly code = 'events.unmanaged_session';

  constructor(eventType: string) {
    super(
      `Event "${eventType}" was emitted inside a caller-owned session with no outbox and no ` +
        'post-commit queue. Wire an outbox or run the write in the engine unit of work.',
    );
  }
}

/** `${name}:v${version}:${occurrence}` — the same occurrence always yields the same id. */
export function eventIdFor(name: string, version: number, occurrence: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('eventIdFor: event name must be a non-empty string');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError(
      `eventIdFor(${name}): version must be a positive integer, got ${String(version)}`,
    );
  }
  if (typeof occurrence !== 'string' || occurrence.length === 0) {
    throw new TypeError(
      `eventIdFor(${name}): occurrence must be a non-empty string, got ${typeof occurrence === 'string' ? '""' : typeof occurrence}`,
    );
  }
  return `${name}:v${version}:${occurrence}`;
}

/** The meta a durable event is created with: a fixed id, and the same value as its idempotency key. */
export function durableEventMeta(
  name: string,
  version: number,
  occurrence: string,
): Required<Pick<EventMeta, 'id' | 'idempotencyKey'>> {
  const id = eventIdFor(name, version, occurrence);
  return { id, idempotencyKey: id };
}

/** Throws unless a durable type is in a unit of work (session + transactional store) or a durable delivery. */
export function requireDurableContext(
  def: { readonly name: string; readonly durability: EventDurability },
  ctx: DurableContext,
): void {
  if (def.durability === 'ephemeral') return;
  if (!ctx.outbox) throw new NonDurablePublishError(def.name, 'no outbox is wired');
  if (ctx.deliveryOf !== undefined) return;
  if (ctx.session === undefined) {
    throw new NonDurablePublishError(
      def.name,
      'no unit of work is open (no session) and this is not a durable delivery',
    );
  }
  if (ctx.outbox.transactionalSave !== true) {
    throw new NonDurablePublishError(
      def.name,
      'the outbox store does not declare transactionalSave',
    );
  }
}

export interface DispatchChannels {
  readonly outbox: OutboxStore | undefined;
  readonly transport: EventTransport | undefined;
  /** With an outbox: `'relay'` = the row is the delivery; `'inline'` (default) = publish live, then acknowledge. */
  readonly dispatch?: 'inline' | 'relay' | undefined;
  /** Prefix for log lines, e.g. the kernel name. */
  readonly label: string;
  readonly logger?: ErrorLogger | undefined;
}

export interface DispatchUnit extends Omit<DurableContext, 'outbox'> {
  /** The post-commit queue of an open unit of work; its owner calls {@link flushDeferredEvents}. */
  readonly pending?: DomainEvent[] | undefined;
}

/** `published` and `relay` are delivered or owned; `publish_failed` leaves a pending row (or nothing, with no outbox). */
export type DispatchOutcome =
  | 'deferred'
  | 'committed'
  | 'relay'
  | 'published'
  | 'publish_failed'
  | 'no_transport';

/**
 * Emit one domain event. The outbox save runs first, in the session, and its failure propagates.
 * In a unit of work delivery waits for {@link flushDeferredEvents}; otherwise an inline publish is
 * acknowledged so the relay does not deliver it again, and a failed one stays pending for the relay.
 */
export async function dispatchDomainEvent(
  channels: DispatchChannels,
  unit: DispatchUnit,
  event: DomainEvent,
  durability: EventDurability,
): Promise<DispatchOutcome> {
  requireDurableContext(
    { name: event.type, durability },
    { session: unit.session, outbox: channels.outbox, deliveryOf: unit.deliveryOf },
  );
  const log = channels.logger ?? console;

  if (channels.outbox) {
    await channels.outbox.save(event, unit.session === undefined ? {} : { session: unit.session });
  } else if (unit.session !== undefined && !unit.pending) {
    throw new UnmanagedSessionError(event.type);
  }

  if (unit.pending) {
    unit.pending.push(event);
    return 'deferred';
  }
  // A caller-owned session with an outbox and no queue: the row commits with it; the relay delivers.
  if (unit.session !== undefined) return 'committed';
  if (channels.outbox && channels.dispatch === 'relay') return 'relay';
  if (!channels.transport) return 'no_transport';

  try {
    await channels.transport.publish(event);
  } catch (err) {
    log.error(`[${channels.label}] publish failed for ${event.type} ${event.meta.id}:`, err);
    return 'publish_failed';
  }
  await acknowledgeDelivered(channels, event, log);
  return 'published';
}

/**
 * Deliver a committed unit of work's queue. Under `'relay'` the rows are the delivery and nothing
 * is published. Returns each published event's outcome (`null` = delivered and acknowledged).
 * Delivered rows are acknowledged with one `acknowledgeMany` when the store has it.
 */
export async function flushDeferredEvents(
  channels: DispatchChannels,
  queue: DomainEvent[],
): Promise<ReadonlyMap<string, Error | null>> {
  const outcomes = new Map<string, Error | null>();
  const events = queue.splice(0);
  if ((channels.outbox && channels.dispatch === 'relay') || !channels.transport) return outcomes;
  const log = channels.logger ?? console;
  for (const event of events) {
    try {
      await channels.transport.publish(event);
    } catch (err) {
      outcomes.set(event.meta.id, err instanceof Error ? err : new Error(String(err)));
      log.error(`[${channels.label}] publish failed for ${event.type} ${event.meta.id}:`, err);
      continue;
    }
    outcomes.set(event.meta.id, null);
  }
  const delivered = events.filter((e) => outcomes.get(e.meta.id) === null);
  const outbox = channels.outbox;
  if (outbox?.acknowledgeMany && delivered.length > 0) {
    // ONE write per flush: a per-event acknowledge makes a unit of work N+1.
    try {
      await outbox.acknowledgeMany(delivered.map((e) => e.meta.id));
    } catch (err) {
      log.error(
        `[${channels.label}] outbox acknowledgeMany failed for ${delivered.length} events:`,
        err,
      );
    }
  } else {
    for (const event of delivered) await acknowledgeDelivered(channels, event, log);
  }
  return outcomes;
}

/** A failed acknowledge only risks a redelivery, which consumers absorb by id; it never fails the caller. */
async function acknowledgeDelivered(
  channels: DispatchChannels,
  event: DomainEvent,
  log: ErrorLogger,
): Promise<void> {
  if (!channels.outbox) return;
  try {
    await channels.outbox.acknowledge(event.meta.id);
  } catch (err) {
    log.error(
      `[${channels.label}] outbox acknowledge failed for ${event.type} ${event.meta.id}:`,
      err,
    );
  }
}
