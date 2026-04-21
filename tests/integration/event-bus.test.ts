/**
 * Scenario — primitives composed into a working event bus.
 *
 * Verifies the integration contract from PACKAGE_RULES.md §11:
 *   - `DomainEvent` / `EventTransport` are structurally compatible with Arc.
 *   - `matchEventPattern` handles the three kinds of subscription (exact,
 *     dotted glob, colon glob).
 *   - `createEvent` produces payloads a transport can publish unchanged.
 *   - Handler errors do not crash sibling handlers (fire-and-forget contract).
 */

import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../../src/events.js';
import { createEvent } from '../../src/events.js';
import { makeInProcessBus, makeOperationContext } from '../helpers/fixtures.js';

describe('primitives compose into an Arc-shaped event bus', () => {
  it('routes an event to exact-match subscribers', async () => {
    const bus = makeInProcessBus();
    const received: DomainEvent[] = [];

    await bus.subscribe('order:placed', (e) => {
      received.push(e);
    });

    const ctx = makeOperationContext();
    await bus.publish(
      createEvent(
        'order:placed',
        { orderId: 'ord_1' },
        {
          organizationId: String(ctx.organizationId),
          userId: String(ctx.actorId),
          correlationId: ctx.correlationId,
        },
      ),
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('order:placed');
    expect(received[0]?.payload).toEqual({ orderId: 'ord_1' });
    expect(received[0]?.meta.organizationId).toBe('org_1');
  });

  it('routes to glob subscribers using Arc convention (both `.` and `:`)', async () => {
    const bus = makeInProcessBus();
    const dotted: string[] = [];
    const coloned: string[] = [];
    const star: string[] = [];

    await bus.subscribe('order.*', (e) => {
      dotted.push(e.type);
    });
    await bus.subscribe('inventory:*', (e) => {
      coloned.push(e.type);
    });
    await bus.subscribe('*', (e) => {
      star.push(e.type);
    });

    await bus.publish(createEvent('order.placed', {}));
    await bus.publish(createEvent('order.cancelled', {}));
    await bus.publish(createEvent('inventory:moved', {}));
    await bus.publish(createEvent('unrelated', {}));

    expect(dotted).toEqual(['order.placed', 'order.cancelled']);
    expect(coloned).toEqual(['inventory:moved']);
    expect(star).toEqual(['order.placed', 'order.cancelled', 'inventory:moved', 'unrelated']);
  });

  it('does not crash sibling handlers when one throws', async () => {
    const bus = makeInProcessBus();
    const sideEffects: string[] = [];

    await bus.subscribe('order:*', () => {
      throw new Error('handler A exploded');
    });
    await bus.subscribe('order:*', (e) => {
      sideEffects.push(`B saw ${e.type}`);
    });
    await bus.subscribe('order:*', (e) => {
      sideEffects.push(`C saw ${e.type}`);
    });

    await bus.publish(createEvent('order:placed', { orderId: 'ord_x' }));

    expect(sideEffects).toEqual(['B saw order:placed', 'C saw order:placed']);
  });

  it('unsubscribe removes a handler without affecting others', async () => {
    const bus = makeInProcessBus();
    const a: string[] = [];
    const b: string[] = [];

    const unsubA = await bus.subscribe('order:*', (e) => {
      a.push(e.type);
    });
    await bus.subscribe('order:*', (e) => {
      b.push(e.type);
    });

    await bus.publish(createEvent('order:placed', {}));
    unsubA();
    await bus.publish(createEvent('order:shipped', {}));

    expect(a).toEqual(['order:placed']);
    expect(b).toEqual(['order:placed', 'order:shipped']);
    expect(bus.subscriptions()).toBe(1);
  });

  it('close() clears all subscriptions', async () => {
    const bus = makeInProcessBus();
    await bus.subscribe('*', () => {});
    await bus.subscribe('order:*', () => {});
    expect(bus.subscriptions()).toBe(2);
    await bus.close?.();
    expect(bus.subscriptions()).toBe(0);
  });
});
