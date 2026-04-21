import { describe, expect, expectTypeOf, it } from 'vitest';
import { createEvent, type DeadLetteredEvent, type DomainEvent } from '../../src/events.js';
import {
  InvalidOutboxEventError,
  type OutboxAcknowledgeOptions,
  type OutboxClaimOptions,
  type OutboxErrorInfo,
  type OutboxFailOptions,
  type OutboxFailureContext,
  type OutboxFailureDecision,
  type OutboxFailurePolicy,
  OutboxOwnershipError,
  type OutboxStore,
  type OutboxWriteOptions,
} from '../../src/outbox.js';

describe('OutboxOwnershipError', () => {
  it('stringifies the event id + attemptedBy + currentOwner', () => {
    const err = new OutboxOwnershipError('evt_123', 'worker-a', 'worker-b');
    expect(err.name).toBe('OutboxOwnershipError');
    expect(err.eventId).toBe('evt_123');
    expect(err.attemptedBy).toBe('worker-a');
    expect(err.currentOwner).toBe('worker-b');
    expect(err.message).toContain('evt_123');
    expect(err.message).toContain('worker-a');
    expect(err.message).toContain('worker-b');
  });

  it('reports "none" when the current lease is unowned', () => {
    const err = new OutboxOwnershipError('evt_9', 'worker-a', null);
    expect(err.currentOwner).toBeNull();
    expect(err.message).toContain('"none"');
  });

  it('is catchable as Error', () => {
    try {
      throw new OutboxOwnershipError('evt_1', 'w', null);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(OutboxOwnershipError);
    }
  });
});

describe('InvalidOutboxEventError', () => {
  it('prefixes the reason with "Invalid outbox event:"', () => {
    const err = new InvalidOutboxEventError('event.meta.id is required');
    expect(err.name).toBe('InvalidOutboxEventError');
    expect(err.message).toBe('Invalid outbox event: event.meta.id is required');
  });

  it('is catchable as Error', () => {
    try {
      throw new InvalidOutboxEventError('whatever');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(InvalidOutboxEventError);
    }
  });
});

describe('OutboxStore — contract shape (type-level)', () => {
  it('lets a minimal store (required methods only) satisfy the contract', () => {
    class MinimalStore implements OutboxStore {
      async save(_event: DomainEvent, _options?: OutboxWriteOptions): Promise<void> {}
      async getPending(_limit: number): Promise<DomainEvent[]> {
        return [];
      }
      async acknowledge(_eventId: string, _options?: OutboxAcknowledgeOptions): Promise<void> {}
    }
    const s: OutboxStore = new MinimalStore();
    expect(typeof s.save).toBe('function');
    expect(typeof s.getPending).toBe('function');
    expect(typeof s.acknowledge).toBe('function');
    expect(s.claimPending).toBeUndefined();
    expect(s.fail).toBeUndefined();
    expect(s.getDeadLettered).toBeUndefined();
    expect(s.purge).toBeUndefined();
  });

  it('lets a full store (all optional capabilities) satisfy the contract', () => {
    class FullStore implements OutboxStore {
      async save(_e: DomainEvent, _o?: OutboxWriteOptions): Promise<void> {}
      async getPending(_l: number): Promise<DomainEvent[]> {
        return [];
      }
      async claimPending(_o?: OutboxClaimOptions): Promise<DomainEvent[]> {
        return [];
      }
      async acknowledge(_id: string, _o?: OutboxAcknowledgeOptions): Promise<void> {}
      async fail(_id: string, _e: OutboxErrorInfo, _o?: OutboxFailOptions): Promise<void> {}
      async getDeadLettered(_l: number): Promise<DeadLetteredEvent[]> {
        return [];
      }
      async purge(_olderThanMs: number): Promise<number> {
        return 0;
      }
    }
    const s: OutboxStore = new FullStore();
    expectTypeOf(s.claimPending).not.toBeUndefined();
    expectTypeOf(s.fail).not.toBeUndefined();
    expectTypeOf(s.getDeadLettered).not.toBeUndefined();
    expectTypeOf(s.purge).not.toBeUndefined();
  });
});

describe('OutboxWriteOptions — idempotency keys flow through', () => {
  it('carries dedupeKey + partitionKey + headers', () => {
    const opts: OutboxWriteOptions = {
      dedupeKey: 'order:ORD-123:payment.authorized',
      partitionKey: 'ORD-123',
      headers: { 'x-source': 'order' },
      visibleAt: new Date('2026-04-17T12:00:00Z'),
    };
    expect(opts.dedupeKey).toBe('order:ORD-123:payment.authorized');
    expect(opts.partitionKey).toBe('ORD-123');
    expect(opts.headers?.['x-source']).toBe('order');
  });
});

describe('OutboxFailurePolicy — retry + DLQ shape', () => {
  it('can return a retryAt for transient failures', async () => {
    const policy: OutboxFailurePolicy = ({ attempts }) => {
      if (attempts >= 5) return { deadLetter: true };
      return { retryAt: new Date(Date.now() + 1000 * attempts) };
    };

    const event = createEvent('order:payment.authorized', { orderId: 'ORD-1' });
    const ctx: OutboxFailureContext = {
      event,
      error: new Error('transport unavailable'),
      attempts: 2,
    };
    const decision = (await policy(ctx)) as OutboxFailureDecision;
    expect(decision.retryAt).toBeInstanceOf(Date);
    expect(decision.deadLetter).toBeUndefined();
  });

  it('can return deadLetter: true after N attempts', async () => {
    const policy: OutboxFailurePolicy = ({ attempts }) =>
      attempts >= 3 ? { deadLetter: true } : {};

    const decision = await policy({
      event: createEvent('cart:checkout.abandoned', {}),
      error: new Error('poison pill'),
      attempts: 3,
    });
    expect((decision as OutboxFailureDecision).deadLetter).toBe(true);
  });
});
