/**
 * `/event-infra` — shared in-process bus + memory outbox (0.13.0).
 *
 * These are the consolidated semantics of the 26 per-kernel
 * `in-process-bus.ts` copies and 15 `outbox-store.ts` copies this module
 * replaces — the assertions pin the UNION contract every kernel relied on.
 */

import { describe, expect, it, vi } from 'vitest';
import { createInProcessBus, InProcessEventBus } from '../../src/events/event-infra.js';
// One import path for the store — `/event-infra` is the bus subpath and no
// longer re-exports it (see the note at the foot of `src/events/event-infra.ts`).
import { MemoryOutboxStore } from '../../src/events/memory-outbox.js';
import { createEvent, createScopedEvent, scopedEventMeta } from '../../src/events/events.js';

describe('InProcessEventBus', () => {
  it('defaults name to "in-process"; accepts a custom name', () => {
    expect(new InProcessEventBus().name).toBe('in-process');
    expect(new InProcessEventBus({ name: 'in-process-purchase' }).name).toBe(
      'in-process-purchase',
    );
  });

  it('routes exact, dotted-glob, colon-glob, and star subscribers', async () => {
    const bus = createInProcessBus();
    const seen: string[] = [];
    await bus.subscribe('order.*', (e) => void seen.push(`dot:${e.type}`));
    await bus.subscribe('inventory:*', (e) => void seen.push(`colon:${e.type}`));
    await bus.subscribe('*', (e) => void seen.push(`star:${e.type}`));
    await bus.subscribe('exact.hit', (e) => void seen.push(`exact:${e.type}`));

    await bus.publish(createEvent('order.placed', {}));
    await bus.publish(createEvent('inventory:moved', {}));
    await bus.publish(createEvent('exact.hit', {}));

    expect(seen).toContain('dot:order.placed');
    expect(seen).toContain('colon:inventory:moved');
    expect(seen).toContain('exact:exact.hit');
    expect(seen.filter((s) => s.startsWith('star:'))).toHaveLength(3);
  });

  it('deduplicates a handler subscribed under multiple matching patterns', async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();
    await bus.subscribe('order.*', handler);
    await bus.subscribe('*', handler);
    await bus.publish(createEvent('order.placed', {}));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('isolates handler errors per-handler and logs via the injected logger', async () => {
    const logger = { error: vi.fn() };
    const bus = new InProcessEventBus({ name: 'in-process-pos', logLabel: 'pos', logger });
    const survivor = vi.fn();
    await bus.subscribe('pos:*', () => {
      throw new Error('boom');
    });
    await bus.subscribe('pos:*', survivor);

    await expect(bus.publish(createEvent('pos:shift.closed', {}))).resolves.toBeUndefined();
    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[pos] handler error for pos:shift.closed:',
      expect.any(Error),
    );
  });

  it('logger: null swallows handler errors silently (cart dialect)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bus = new InProcessEventBus({ logger: null });
      await bus.subscribe('*', () => {
        throw new Error('silent');
      });
      await bus.publish(createEvent('x', {}));
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('publishMany reports per-event outcomes keyed by meta.id', async () => {
    const bus = new InProcessEventBus({ logger: null });
    const a = createEvent('a', {});
    const b = createEvent('b', {});
    const result = await bus.publishMany([a, b]);
    expect(result.get(a.meta.id)).toBeNull();
    expect(result.get(b.meta.id)).toBeNull();
  });

  describe('propagateHandlerErrors (0.15.0 — projection/relay lanes)', () => {
    it('default (omitted) still isolates: failing handler is logged, sibling runs, publish resolves', async () => {
      const logger = { error: vi.fn() };
      const bus = new InProcessEventBus({ logger });
      const survivor = vi.fn();
      await bus.subscribe('proj.*', () => {
        throw new Error('boom');
      });
      await bus.subscribe('proj.*', survivor);

      await expect(bus.publish(createEvent('proj.updated', {}))).resolves.toBeUndefined();
      expect(survivor).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('explicit false behaves identically to omitted', async () => {
      const logger = { error: vi.fn() };
      const bus = new InProcessEventBus({ propagateHandlerErrors: false, logger });
      await bus.subscribe('*', () => {
        throw new Error('boom');
      });
      await expect(bus.publish(createEvent('x', {}))).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('strict mode rethrows the handler error to the publisher, does not log, and skips later subscribers', async () => {
      const logger = { error: vi.fn() };
      const bus = new InProcessEventBus({ propagateHandlerErrors: true, logger });
      const skipped = vi.fn();
      const failure = new Error('projection failed');
      await bus.subscribe('proj.*', () => {
        throw failure;
      });
      await bus.subscribe('proj.*', skipped);

      await expect(bus.publish(createEvent('proj.updated', {}))).rejects.toBe(failure);
      expect(skipped).not.toHaveBeenCalled(); // sequential-rethrow: later subscribers starve
      expect(logger.error).not.toHaveBeenCalled(); // error is the publisher's to handle
    });

    it('strict mode via createInProcessBus rethrows async rejections too', async () => {
      const bus = createInProcessBus({ propagateHandlerErrors: true });
      await bus.subscribe('*', async () => {
        throw new Error('async boom');
      });
      await expect(bus.publish(createEvent('x', {}))).rejects.toThrow('async boom');
    });

    it('strict mode with no failure delivers to all subscribers normally', async () => {
      const bus = new InProcessEventBus({ propagateHandlerErrors: true });
      const a = vi.fn();
      const b = vi.fn();
      await bus.subscribe('ok.*', a);
      await bus.subscribe('*', b);
      await expect(bus.publish(createEvent('ok.done', {}))).resolves.toBeUndefined();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('strict mode publishMany maps per-event failures into the result (batch does not reject)', async () => {
      const bus = new InProcessEventBus({ propagateHandlerErrors: true });
      await bus.subscribe('bad', () => {
        throw new Error('boom');
      });
      const good = createEvent('good', {});
      const bad = createEvent('bad', {});
      const result = await bus.publishMany([good, bad]);
      expect(result.get(good.meta.id)).toBeNull();
      expect(result.get(bad.meta.id)).toBeInstanceOf(Error);
      expect((result.get(bad.meta.id) as Error).message).toBe('boom');
    });

    it('strict mode leaves unsubscribe and close semantics unchanged', async () => {
      const bus = new InProcessEventBus({ propagateHandlerErrors: true });
      const kept = vi.fn();
      const removed = vi.fn(() => {
        throw new Error('would have propagated');
      });
      const unsub = await bus.subscribe('t', removed);
      await bus.subscribe('t', kept);

      unsub();
      await expect(bus.publish(createEvent('t', {}))).resolves.toBeUndefined();
      expect(removed).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledTimes(1);

      await bus.close();
      await bus.publish(createEvent('t', {}));
      expect(kept).toHaveBeenCalledTimes(1); // publish after close is a no-op
      await expect(bus.close()).resolves.toBeUndefined(); // idempotent
    });
  });

  it('unsubscribe removes only that handler; close clears everything and is idempotent', async () => {
    const bus = new InProcessEventBus();
    const kept = vi.fn();
    const removed = vi.fn();
    const unsub = await bus.subscribe('t', removed);
    await bus.subscribe('t', kept);

    unsub();
    await bus.publish(createEvent('t', {}));
    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);

    await bus.close();
    await bus.publish(createEvent('t', {}));
    expect(kept).toHaveBeenCalledTimes(1); // publish after close is a no-op
    await expect(bus.close()).resolves.toBeUndefined(); // idempotent
  });
});

describe('MemoryOutboxStore', () => {
  it('save / getPending / acknowledge round-trip', async () => {
    const store = new MemoryOutboxStore();
    const e1 = createEvent('a', {});
    const e2 = createEvent('b', {});
    await store.save(e1);
    await store.save(e2);

    expect(await store.getPending(10)).toHaveLength(2);
    await store.acknowledge(e1.meta.id);
    const pending = await store.getPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.meta.id).toBe(e2.meta.id);
    // Unknown eventId is a no-op (contract rule 4).
    await expect(store.acknowledge('nope')).resolves.toBeUndefined();
  });

  it('respects the getPending limit (FIFO)', async () => {
    const store = new MemoryOutboxStore();
    const events = [createEvent('a', {}), createEvent('b', {}), createEvent('c', {})];
    for (const e of events) await store.save(e);
    const page = await store.getPending(2);
    expect(page.map((e) => e.meta.id)).toEqual([events[0]?.meta.id, events[1]?.meta.id]);
  });

  it('purge removes only old acknowledged events', async () => {
    const store = new MemoryOutboxStore();
    const acked = createEvent('a', {});
    const live = createEvent('b', {});
    await store.save(acked);
    await store.save(live);
    await store.acknowledge(acked.meta.id);

    const purged = await store.purge(-1); // cutoff in the future — acked is stale
    expect(purged).toBe(1);
    expect(store.all()).toHaveLength(1);
    expect((await store.getPending(10))[0]?.meta.id).toBe(live.meta.id);

    store.clear();
    expect(store.all()).toHaveLength(0);
  });
});

describe('scopedEventMeta / createScopedEvent', () => {
  it('maps actorId → userId (stringified), organizationId, correlationId; omits absent fields', () => {
    const oid = { toString: () => 'org_1' };
    expect(scopedEventMeta({ actorId: 42, organizationId: oid, correlationId: 'c1' })).toEqual({
      userId: '42',
      organizationId: 'org_1',
      correlationId: 'c1',
    });
    expect(scopedEventMeta({})).toEqual({});
    expect(scopedEventMeta()).toEqual({});
    // absent fields are omitted, not set to undefined (exactOptionalPropertyTypes)
    expect(Object.keys(scopedEventMeta({ actorRef: 'user:9' }))).toEqual(['userId']);
  });

  it('falls back to actorRef when actorId is absent', () => {
    expect(scopedEventMeta({ actorRef: 'guest:abc' })).toEqual({ userId: 'guest:abc' });
    expect(scopedEventMeta({ actorId: 'u1', actorRef: 'guest:abc' })).toEqual({ userId: 'u1' });
  });

  it('createScopedEvent stamps source + scoped meta; caller meta wins', () => {
    const e = createScopedEvent(
      '@classytic/purchase',
      'purchase:order.created',
      { orderId: 'po_1' },
      { actorId: 'u_1', organizationId: 'org_1', correlationId: 'c_1' },
      { resourceId: 'po_1', userId: 'override' },
    );
    expect(e.type).toBe('purchase:order.created');
    expect(e.meta.source).toBe('@classytic/purchase');
    expect(e.meta.organizationId).toBe('org_1');
    expect(e.meta.correlationId).toBe('c_1');
    expect(e.meta.userId).toBe('override'); // caller meta wins over ctx mapping
    expect(e.meta.resourceId).toBe('po_1');
    expect(typeof e.meta.id).toBe('string');
    expect(e.meta.timestamp).toBeInstanceOf(Date);
  });
});
