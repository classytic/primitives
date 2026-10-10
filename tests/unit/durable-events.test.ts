import { describe, expect, it } from 'vitest';
import {
  dispatchDomainEvent,
  durableEventMeta,
  eventIdFor,
  flushDeferredEvents,
  NonDurablePublishError,
  requireDurableContext,
  UnmanagedSessionError,
} from '../../src/events/durable.js';
import { InProcessEventBus } from '../../src/events/event-infra.js';
import { createChildEvent, createEvent, type DomainEvent } from '../../src/events/events.js';
import { MemoryOutboxStore } from '../../src/events/memory-outbox.js';
import { OutboxConflictError } from '../../src/events/outbox.js';

/** A store that enlists the session — what a mongoose-backed store on the same connection declares. */
class TransactionalMemoryStore extends MemoryOutboxStore {
  readonly transactionalSave = true;
  readonly sessions: unknown[] = [];
  override async save(event: DomainEvent, options?: { session?: unknown }): Promise<void> {
    this.sessions.push(options?.session);
    await super.save(event, options);
  }
}

const SESSION = { id: 'txn-1' };

const issued = (
  occurrence: string,
  amount = 125_000,
): DomainEvent<{ amount: number; lines: number }> =>
  createEvent(
    'order:goods.issued',
    { amount, lines: 3 },
    durableEventMeta('order:goods.issued', 1, occurrence),
  );

describe('eventIdFor / durableEventMeta', () => {
  it('derives the same id for the same occurrence, and a different id per step', () => {
    expect(eventIdFor('order:goods.issued', 1, 'ful_1')).toBe('order:goods.issued:v1:ful_1');
    expect(eventIdFor('order:goods.issued', 1, 'ful_2')).not.toBe(
      eventIdFor('order:goods.issued', 1, 'ful_1'),
    );
    expect(durableEventMeta('order:goods.issued', 2, 'ful_1')).toEqual({
      id: 'order:goods.issued:v2:ful_1',
      idempotencyKey: 'order:goods.issued:v2:ful_1',
    });
  });

  it('refuses an empty or non-string occurrence instead of minting a shared id', () => {
    expect(() => eventIdFor('order:goods.issued', 1, '')).toThrow(/occurrence/);
    // A runtime caller can hand anything; the guard is at run time, not only in the type.
    expect(() => Reflect.apply(eventIdFor, undefined, ['order:goods.issued', 1, 42])).toThrow(
      /occurrence/,
    );
    expect(() =>
      Reflect.apply(eventIdFor, undefined, ['order:goods.issued', 1, undefined]),
    ).toThrow(/occurrence/);
    expect(() => eventIdFor('', 1, 'x')).toThrow(/name/);
    expect(() => eventIdFor('a:b', 0, 'x')).toThrow(/version/);
  });
});

describe('requireDurableContext', () => {
  const durable = { name: 'order:goods.issued', durability: 'durable' as const };

  it('lets an ephemeral type publish from anywhere', () => {
    expect(() =>
      requireDurableContext({ name: 'cart:viewed', durability: 'ephemeral' }, {}),
    ).not.toThrow();
  });

  it('refuses a durable type with no outbox, a non-transactional store, or no session', () => {
    expect(() => requireDurableContext(durable, {})).toThrow(NonDurablePublishError);
    expect(() =>
      requireDurableContext(durable, { session: SESSION, outbox: new MemoryOutboxStore() }),
    ).toThrow(/transactionalSave/);
    expect(() =>
      requireDurableContext(durable, { outbox: new TransactionalMemoryStore() }),
    ).toThrow(NonDurablePublishError);
  });

  it('accepts a unit of work, and a durable delivery that saves its child row', () => {
    const outbox = new TransactionalMemoryStore();
    expect(() => requireDurableContext(durable, { session: SESSION, outbox })).not.toThrow();
    expect(() =>
      requireDurableContext(durable, { deliveryOf: 'parent-1', outbox: new MemoryOutboxStore() }),
    ).not.toThrow();
  });

  it('names the event and carries a closed code', () => {
    try {
      requireDurableContext(durable, {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(NonDurablePublishError);
      expect((err as NonDurablePublishError).code).toBe('events.non_durable_publish');
      expect((err as NonDurablePublishError).eventType).toBe('order:goods.issued');
    }
  });
});

describe('dispatchDomainEvent', () => {
  it('inline delivery publishes AND acknowledges the row, so the relay does not deliver it again', async () => {
    const outbox = new MemoryOutboxStore();
    const bus = new InProcessEventBus({ logger: null });
    const seen: string[] = [];
    await bus.subscribe('order:*', async (e) => {
      seen.push(e.meta.id);
    });

    const outcome = await dispatchDomainEvent(
      { outbox, transport: bus, label: 'test' },
      {},
      createEvent('order:noted', { note: 'x' }),
      'ephemeral',
    );

    expect(outcome).toBe('published');
    expect(seen).toHaveLength(1);
    expect(await outbox.countByStatus('pending')).toBe(0);
    expect(await outbox.countByStatus('delivered')).toBe(1);
  });

  it('a throwing handler leaves the row PENDING for the relay — the event is not lost', async () => {
    const outbox = new MemoryOutboxStore();
    const bus = new InProcessEventBus({ propagateHandlerErrors: true });
    await bus.subscribe('order:*', async () => {
      throw new Error('ledger down');
    });
    const errors: string[] = [];

    const outcome = await dispatchDomainEvent(
      { outbox, transport: bus, label: 'test', logger: { error: (m) => errors.push(m) } },
      {},
      createEvent('order:noted', { note: 'x' }),
      'ephemeral',
    );

    expect(outcome).toBe('publish_failed');
    expect(await outbox.countByStatus('pending')).toBe(1);
    expect(errors.join()).toContain('order:noted');
  });

  it('inside a unit of work the row is saved in the session and delivery waits for commit', async () => {
    const outbox = new TransactionalMemoryStore();
    const bus = new InProcessEventBus({ logger: null });
    const seen: string[] = [];
    await bus.subscribe('*', async (e) => {
      seen.push(e.type);
    });
    const pending: DomainEvent[] = [];
    const channels = { outbox, transport: bus, label: 'test' };

    const outcome = await dispatchDomainEvent(
      channels,
      { session: SESSION, pending },
      issued('ful_1'),
      'durable',
    );

    expect(outcome).toBe('deferred');
    expect(outbox.sessions).toEqual([SESSION]);
    expect(seen).toEqual([]);

    const delivered = await flushDeferredEvents(channels, pending);
    expect(delivered.get('order:goods.issued:v1:ful_1')).toBeNull();
    expect(seen).toEqual(['order:goods.issued']);
    expect(pending).toHaveLength(0);
    expect(await outbox.countByStatus('delivered')).toBe(1);
  });

  it('a durable type outside a unit of work throws BEFORE anything is saved or published', async () => {
    const outbox = new MemoryOutboxStore();
    const bus = new InProcessEventBus({ logger: null });
    const seen: string[] = [];
    await bus.subscribe('*', async (e) => {
      seen.push(e.type);
    });

    await expect(
      dispatchDomainEvent(
        { outbox, transport: bus, label: 'test' },
        {},
        issued('ful_1'),
        'durable',
      ),
    ).rejects.toBeInstanceOf(NonDurablePublishError);
    expect(outbox.all()).toHaveLength(0);
    expect(seen).toEqual([]);
  });

  it('a failed outbox save propagates, so the caller rolls back', async () => {
    const outbox = new TransactionalMemoryStore();
    outbox.save = async () => {
      throw new Error('write conflict');
    };
    await expect(
      dispatchDomainEvent(
        { outbox, transport: undefined, label: 'test' },
        { session: SESSION, pending: [] },
        issued('ful_1'),
        'durable',
      ),
    ).rejects.toThrow('write conflict');
  });

  it('an open session with neither an outbox nor a queue refuses — never a ghost event', async () => {
    await expect(
      dispatchDomainEvent(
        { outbox: undefined, transport: new InProcessEventBus({ logger: null }), label: 'test' },
        { session: SESSION },
        createEvent('order:noted', {}),
        'ephemeral',
      ),
    ).rejects.toBeInstanceOf(UnmanagedSessionError);
  });

  it("'relay' dispatch leaves the row as the delivery and publishes nothing live", async () => {
    const outbox = new MemoryOutboxStore();
    const bus = new InProcessEventBus({ logger: null });
    const seen: string[] = [];
    await bus.subscribe('*', async (e) => {
      seen.push(e.type);
    });
    const channels = { outbox, transport: bus, dispatch: 'relay' as const, label: 'test' };

    expect(
      await dispatchDomainEvent(channels, {}, createEvent('order:noted', {}), 'ephemeral'),
    ).toBe('relay');
    const queue = [createEvent('order:noted', {})];
    expect((await flushDeferredEvents(channels, queue)).size).toBe(0);
    expect(queue).toHaveLength(0);
    expect(seen).toEqual([]);
    expect(await outbox.countByStatus('pending')).toBe(1);
  });

  it('a redelivered durable delivery saves its child row once (fixed id)', async () => {
    const outbox = new MemoryOutboxStore();
    const channels = { outbox, transport: undefined, dispatch: 'relay' as const, label: 'test' };
    const unit = { deliveryOf: 'order:goods.issued:v1:ful_1' };

    await dispatchDomainEvent(channels, unit, issued('ful_1:cogs'), 'durable');
    await dispatchDomainEvent(channels, unit, issued('ful_1:cogs'), 'durable');

    expect(outbox.all()).toHaveLength(1);
  });
});

describe('outbox identity', () => {
  it('a second save under the same id with a DIFFERENT payload throws instead of vanishing', async () => {
    const outbox = new MemoryOutboxStore();
    await outbox.save(issued('ful_1', 125_000));
    await outbox.save(issued('ful_1', 125_000));
    await expect(outbox.save(issued('ful_1', 99_000))).rejects.toBeInstanceOf(OutboxConflictError);
    expect(outbox.all()).toHaveLength(1);
  });
});

describe('createChildEvent', () => {
  it('does NOT inherit the parent idempotencyKey — two child types would collide on one key', () => {
    const parent = createEvent(
      'order:placed',
      { amount: 1 },
      { idempotencyKey: 'order:ord_1:place' },
    );
    const child = createChildEvent(parent, 'invoice:issued', { amount: 1 });
    expect(child.meta.idempotencyKey).toBeUndefined();
    expect(child.meta.causationId).toBe(parent.meta.id);
  });
});
