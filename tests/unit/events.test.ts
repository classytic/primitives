import { describe, expect, it } from 'vitest';
import type { DeadLetteredEvent, DomainEvent, EventMeta } from '../../src/events/events.js';
import { createChildEvent, createEvent, matchEventPattern } from '../../src/events/events.js';

describe('createEvent', () => {
  it('fills id and timestamp automatically', () => {
    const e = createEvent('order:placed', { orderId: 'ord_1' });
    expect(e.type).toBe('order:placed');
    expect(e.payload).toEqual({ orderId: 'ord_1' });
    expect(typeof e.meta.id).toBe('string');
    expect(e.meta.id.length).toBeGreaterThan(0);
    expect(e.meta.timestamp).toBeInstanceOf(Date);
  });

  it('passes through meta fields', () => {
    const e = createEvent(
      'order:placed',
      { orderId: 'ord_1' },
      {
        organizationId: 'org_9',
        userId: 'user_3',
        correlationId: 'corr_x',
        resource: 'order',
        resourceId: 'ord_1',
      },
    );
    expect(e.meta.organizationId).toBe('org_9');
    expect(e.meta.userId).toBe('user_3');
    expect(e.meta.correlationId).toBe('corr_x');
    expect(e.meta.resource).toBe('order');
    expect(e.meta.resourceId).toBe('ord_1');
  });

  it('produces distinct ids across calls', () => {
    const a = createEvent('a', {});
    const b = createEvent('a', {});
    expect(a.meta.id).not.toBe(b.meta.id);
  });

  it('preserves exact payload reference (no cloning)', () => {
    const payload = { nested: { count: 1 } };
    const e = createEvent('x', payload);
    expect(e.payload).toBe(payload);
  });

  it('accepts the full Partial<EventMeta> shape including v2.9 fields', () => {
    const e = createEvent(
      'order:placed',
      { id: 'ord_1' },
      {
        schemaVersion: 2,
        causationId: 'parent_evt',
        partitionKey: 'ord_1',
        source: 'commerce',
        idempotencyKey: 'order:ord_1:place',
        aggregate: { type: 'order', id: 'ord_1' },
      },
    );
    expect(e.meta.schemaVersion).toBe(2);
    expect(e.meta.causationId).toBe('parent_evt');
    expect(e.meta.partitionKey).toBe('ord_1');
    expect(e.meta.source).toBe('commerce');
    expect(e.meta.idempotencyKey).toBe('order:ord_1:place');
    expect(e.meta.aggregate).toEqual({ type: 'order', id: 'ord_1' });
  });

  it('caller-supplied meta wins over defaults (id + timestamp)', () => {
    const fixedTs = new Date('2026-01-01T00:00:00Z');
    const e = createEvent('order:placed', {}, { id: 'fixed-id', timestamp: fixedTs });
    expect(e.meta.id).toBe('fixed-id');
    expect(e.meta.timestamp).toBe(fixedTs);
  });
});

describe('createChildEvent — causation chain', () => {
  it('sets causationId to parent id and inherits correlationId', () => {
    const parent = createEvent(
      'order:placed',
      { orderId: 'ord_1' },
      { correlationId: 'corr_root', userId: 'user_1', organizationId: 'org_1' },
    );
    const child = createChildEvent(parent, 'inventory:reserved', {
      orderId: 'ord_1',
    });

    expect(child.meta.causationId).toBe(parent.meta.id);
    expect(child.meta.correlationId).toBe('corr_root');
    expect(child.meta.userId).toBe('user_1');
    expect(child.meta.organizationId).toBe('org_1');
    expect(child.meta.id).not.toBe(parent.meta.id);
  });

  it('falls back to parent.id as correlation root when parent has none', () => {
    const parent = createEvent('order:placed', {});
    const child = createChildEvent(parent, 'inventory:reserved', {});
    expect(child.meta.correlationId).toBe(parent.meta.id);
    expect(child.meta.causationId).toBe(parent.meta.id);
  });

  it('does not inherit userId/organizationId when parent has none', () => {
    const parent = createEvent('order:placed', {}, { correlationId: 'corr' });
    const child = createChildEvent(parent, 'inventory:reserved', {});
    expect(child.meta.userId).toBeUndefined();
    expect(child.meta.organizationId).toBeUndefined();
  });

  it('inherits source + idempotencyKey from parent', () => {
    const parent = createEvent(
      'order:placed',
      {},
      {
        correlationId: 'corr_x',
        source: 'commerce',
        idempotencyKey: 'order:ord_1:place',
      },
    );
    const child = createChildEvent(parent, 'inventory:reserved', {});
    expect(child.meta.source).toBe('commerce');
    expect(child.meta.idempotencyKey).toBe('order:ord_1:place');
  });

  it('does NOT inherit aggregate (child usually belongs to a different aggregate)', () => {
    const parent = createEvent('order:placed', {}, { aggregate: { type: 'order', id: 'ord_1' } });
    const child = createChildEvent(parent, 'shipment:dispatched', {});
    expect(child.meta.aggregate).toBeUndefined();
  });

  it('allows a child to set its own aggregate explicitly', () => {
    const parent = createEvent('order:placed', {}, { aggregate: { type: 'order', id: 'ord_1' } });
    const child = createChildEvent(
      parent,
      'shipment:dispatched',
      {},
      {
        aggregate: { type: 'shipment', id: 'shp_9' },
      },
    );
    expect(child.meta.aggregate).toEqual({ type: 'shipment', id: 'shp_9' });
  });

  it('does not inherit source/idempotencyKey when parent has none', () => {
    const parent = createEvent('order:placed', {});
    const child = createChildEvent(parent, 'inventory:reserved', {});
    expect(child.meta.source).toBeUndefined();
    expect(child.meta.idempotencyKey).toBeUndefined();
  });

  it('caller overrides inherited source + idempotencyKey', () => {
    const parent = createEvent(
      'order:placed',
      {},
      { source: 'commerce', idempotencyKey: 'order:ord_1:place' },
    );
    const child = createChildEvent(
      parent,
      'inventory:reserved',
      {},
      {
        source: 'inventory-service',
        idempotencyKey: 'inventory:reserve:ord_1',
      },
    );
    expect(child.meta.source).toBe('inventory-service');
    expect(child.meta.idempotencyKey).toBe('inventory:reserve:ord_1');
  });

  it('caller-supplied meta overrides inherited fields', () => {
    const parent = createEvent(
      'order:placed',
      {},
      { correlationId: 'corr_root', userId: 'user_1', organizationId: 'org_1' },
    );
    const child = createChildEvent(
      parent,
      'subsystem:act',
      {},
      {
        userId: 'service_account',
        organizationId: 'org_admin',
      },
    );
    expect(child.meta.userId).toBe('service_account');
    expect(child.meta.organizationId).toBe('org_admin');
    // correlation still inherited because caller didn't override it
    expect(child.meta.correlationId).toBe('corr_root');
    // causation still chained because caller didn't override it
    expect(child.meta.causationId).toBe(parent.meta.id);
  });

  it('3-level causation chain keeps correlation stable and chains causation', () => {
    const root = createEvent('order:placed', {}, { correlationId: 'corr_root' });
    const child = createChildEvent(root, 'inventory:reserved', {});
    const grandchild = createChildEvent(child, 'shipment:ready', {});

    // All three events share the same correlation group
    expect(root.meta.correlationId).toBe('corr_root');
    expect(child.meta.correlationId).toBe('corr_root');
    expect(grandchild.meta.correlationId).toBe('corr_root');

    // Causation chains direct parent → child
    expect(child.meta.causationId).toBe(root.meta.id);
    expect(grandchild.meta.causationId).toBe(child.meta.id);

    // Three distinct ids
    const ids = new Set([root.meta.id, child.meta.id, grandchild.meta.id]);
    expect(ids.size).toBe(3);
  });
});

describe('matchEventPattern', () => {
  it('wildcard matches anything', () => {
    expect(matchEventPattern('*', 'order:placed')).toBe(true);
    expect(matchEventPattern('*', 'inventory.move.created')).toBe(true);
    expect(matchEventPattern('*', '')).toBe(true);
  });

  it('dot-glob matches prefixed types', () => {
    expect(matchEventPattern('order.*', 'order.placed')).toBe(true);
    expect(matchEventPattern('order.*', 'order.cancelled')).toBe(true);
    expect(matchEventPattern('order.*', 'order.')).toBe(true);
    expect(matchEventPattern('order.*', 'invoice.placed')).toBe(false);
    expect(matchEventPattern('order.*', 'order')).toBe(false);
  });

  it('colon-glob matches colon-prefixed types (Classytic convention)', () => {
    expect(matchEventPattern('order:*', 'order:placed')).toBe(true);
    expect(matchEventPattern('order:*', 'order:cancelled')).toBe(true);
    expect(matchEventPattern('order:*', 'invoice:placed')).toBe(false);
  });

  it('exact match is strict', () => {
    expect(matchEventPattern('order:placed', 'order:placed')).toBe(true);
    expect(matchEventPattern('order:placed', 'order:shipped')).toBe(false);
    expect(matchEventPattern('order:placed', 'order:placed.extra')).toBe(false);
  });
});

describe('DeadLetteredEvent — type envelope', () => {
  it('wraps an original event with failure context', () => {
    const original: DomainEvent<{ orderId: string }> = createEvent(
      'order:placed',
      { orderId: 'ord_1' },
      { correlationId: 'corr_x' },
    );

    const dlq: DeadLetteredEvent<{ orderId: string }> = {
      event: original,
      error: {
        message: 'inventory service unreachable',
        code: 'INVENTORY_TIMEOUT',
        stack: 'Error: inventory service unreachable\n    at ...',
      },
      attempts: 5,
      firstFailedAt: new Date('2026-01-01T10:00:00Z'),
      lastFailedAt: new Date('2026-01-01T10:05:30Z'),
      handlerName: 'inventory-reservation-handler',
    };

    expect(dlq.event).toBe(original);
    expect(dlq.event.meta.correlationId).toBe('corr_x');
    expect(dlq.error.message).toBe('inventory service unreachable');
    expect(dlq.error.code).toBe('INVENTORY_TIMEOUT');
    expect(dlq.attempts).toBe(5);
    expect(dlq.firstFailedAt.getTime()).toBeLessThan(dlq.lastFailedAt.getTime());
    expect(dlq.handlerName).toBe('inventory-reservation-handler');
  });

  it('permits minimal error shape (message only)', () => {
    const dlq: DeadLetteredEvent = {
      event: createEvent('x', {}),
      error: { message: 'something broke' },
      attempts: 1,
      firstFailedAt: new Date(),
      lastFailedAt: new Date(),
    };
    expect(dlq.error.code).toBeUndefined();
    expect(dlq.error.stack).toBeUndefined();
    expect(dlq.handlerName).toBeUndefined();
  });
});

describe('EventMeta — v2.9 shape (mirrored from arc)', () => {
  it('accepts all documented optional fields on construction', () => {
    const meta: EventMeta = {
      id: 'evt_1',
      timestamp: new Date(),
      schemaVersion: 3,
      correlationId: 'corr',
      causationId: 'parent',
      partitionKey: 'ord_1',
      resource: 'order',
      resourceId: 'ord_1',
      userId: 'user',
      organizationId: 'org',
      source: 'commerce',
      idempotencyKey: 'order:ord_1:place',
      aggregate: { type: 'order', id: 'ord_1' },
    };
    expect(meta.schemaVersion).toBe(3);
    expect(meta.partitionKey).toBe('ord_1');
    expect(meta.causationId).toBe('parent');
    expect(meta.source).toBe('commerce');
    expect(meta.idempotencyKey).toBe('order:ord_1:place');
    expect(meta.aggregate).toEqual({ type: 'order', id: 'ord_1' });
  });

  it('aggregate.type is a plain string — downstream packages narrow via interface extension', () => {
    // Simulates how cart / order would narrow aggregate.type via interface extension
    type OrderAggregateType = 'order' | 'order-line';
    interface OrderEventMeta extends EventMeta {
      aggregate?: { type: OrderAggregateType; id: string };
    }

    const narrow: OrderEventMeta = {
      id: 'evt',
      timestamp: new Date(),
      aggregate: { type: 'order', id: 'ord_1' },
    };
    // A narrowed meta is assignable back to the base (subtype)
    const base: EventMeta = narrow;
    expect(base.aggregate?.type).toBe('order');
  });
});
