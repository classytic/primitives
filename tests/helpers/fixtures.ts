/**
 * Shared fixture builders for tests. Every builder accepts `Partial<T>`
 * overrides so two tests never collide by sharing the same seed. Never
 * hard-code ids — always let the caller specify what matters.
 */

import type { Address, ContactAddress, GeoPoint } from '../../src/address.js';
import type { OperationContext } from '../../src/context.js';
import type { DomainEvent, EventMeta, EventTransport } from '../../src/events.js';
import { matchEventPattern } from '../../src/events.js';
import type { Money } from '../../src/money.js';
import type { DateRange } from '../../src/period.js';
import type { ExternalRef } from '../../src/reference.js';
import type { TenantConfig } from '../../src/tenant.js';

export function makeMoney(overrides: Partial<Money> = {}): Money {
  return { amount: 1000, currency: 'USD', ...overrides };
}

export function makeEventMeta(overrides: Partial<EventMeta> = {}): EventMeta {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function makeEvent<T>(
  type: string,
  payload: T,
  meta: Partial<EventMeta> = {},
): DomainEvent<T> {
  return { type, payload, meta: makeEventMeta(meta) };
}

export function makeOperationContext(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    actorId: 'user_1',
    organizationId: 'org_1',
    traceId: 'trace_1',
    correlationId: 'corr_1',
    ...overrides,
  };
}

export function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    enabled: true,
    tenantField: 'organizationId',
    fieldType: 'objectId',
    ref: 'organization',
    contextKey: 'organizationId',
    required: true,
    ...overrides,
  };
}

export function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    line1: '123 Main St',
    city: 'Dhaka',
    country: 'BD',
    ...overrides,
  };
}

export function makeContactAddress(overrides: Partial<ContactAddress> = {}): ContactAddress {
  return { ...makeAddress(), name: 'Test User', phone: '+8801000000000', ...overrides };
}

export function makeGeoPoint(overrides: Partial<GeoPoint> = {}): GeoPoint {
  return { latitude: 23.7808, longitude: 90.2792, ...overrides };
}

export function makeDateRange(overrides: Partial<DateRange> = {}): DateRange {
  return {
    start: new Date('2026-01-01T00:00:00Z'),
    end: new Date('2026-12-31T23:59:59Z'),
    ...overrides,
  };
}

export function makeExternalRef(overrides: Partial<ExternalRef> = {}): ExternalRef {
  return { sourceId: 'src_1', sourceModel: 'Order', ...overrides };
}

/**
 * Tiny in-process bus that uses `matchEventPattern` internally — the exact
 * shape a package would ship as a default fallback per PACKAGE_RULES.md §13.
 * Returned from a helper because integration tests need it to verify that
 * primitives compose into a working transport without adapters.
 */
export function makeInProcessBus(): EventTransport & {
  subscriptions(): number;
  publishedEvents(): readonly DomainEvent[];
} {
  type Sub = { pattern: string; handler: (e: DomainEvent) => void | Promise<void> };
  const subs = new Set<Sub>();
  const published: DomainEvent[] = [];

  return {
    name: 'in-process-test-bus',
    async publish(event) {
      published.push(event);
      for (const sub of subs) {
        if (matchEventPattern(sub.pattern, event.type)) {
          try {
            await sub.handler(event);
          } catch {
            // swallow — per arc MemoryEventTransport contract: handler errors
            // never crash sibling handlers
          }
        }
      }
    },
    async subscribe(pattern, handler) {
      const sub = { pattern, handler };
      subs.add(sub);
      return () => {
        subs.delete(sub);
      };
    },
    async close() {
      subs.clear();
    },
    subscriptions: () => subs.size,
    publishedEvents: () => [...published],
  };
}
