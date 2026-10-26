# Events: envelope, bus, outbox, durable dispatch

Subpaths: `/events`, `/event-infra`, `/memory-outbox`, `/outbox`, `/durable-events`. This package owns the contracts plus an in-process bus and a memory outbox for dev and tests. The durable store and relay come from arc or a database kit; implement `OutboxStore` only when writing a store.

## /events
- `createEvent(type, payload, meta?)` -> `{ type, payload, meta }`; `meta.id` and `meta.timestamp` are filled. Meta keys: `organizationId`, `userId`, `correlationId`, `causationId`, `idempotencyKey`, `source`, `resource`, `resourceId`, `aggregate`, `partitionKey`, `schemaVersion`.
- `createChildEvent(parent, type, payload)` sets `causationId` to the parent id and inherits correlation, user, organization and source (not `idempotencyKey`).
- `createScopedEvent(source, type, payload, ctx)` and `scopedEventMeta(ctx)` map an actor and organization context (`actorId`, `organizationId`, `correlationId`) to meta.
- `matchEventPattern(pattern, type)`: `*` matches all, `prefix.*` and `prefix:*` match by prefix (nested names included), else exact. `createEventRouter()` stores values per pattern: `add`, `remove`, `route(type)`, `clear`.
- `diffEventSchema(before, after)` lists schema changes with `breaking` flags (use it in contract tests).
- Types: `DomainEvent<T>`, `EventMeta`, `EventHandler`, `EventTransport` (`publish`, optional `publishMany`, `subscribe`, `deadLetter`, `close`), `DeadLetteredEvent`, `PublishManyResult`, `EventLogger`.

```ts
import { createChildEvent, createEvent, matchEventPattern } from "@classytic/primitives/events";

const placed = createEvent("order.placed", { orderId: "o1" }, { organizationId: "org1" });
const issued = createChildEvent(placed, "invoice.issued", { orderId: "o1" });
console.log(issued.meta.causationId === placed.meta.id, matchEventPattern("order.*", "order.placed"));
```

## /event-infra
`createInProcessBus(options?)` (or `new InProcessEventBus`) implements `EventTransport` in memory: `publish`, `publishMany`, `subscribe(pattern, handler)` returning an unsubscribe function, `close`. Options: `name` (default `in-process`), `logger`, `logLabel`, `propagateHandlerErrors`. Kernels subclass it to set a name.

```ts
import { createInProcessBus } from "@classytic/primitives/event-infra";
import { createEvent } from "@classytic/primitives/events";

const bus = createInProcessBus({ name: "in-process-orders" });
const seen: string[] = [];
const unsubscribe = await bus.subscribe("order.*", (e) => { seen.push(e.type); });
await bus.publish(createEvent("order.placed", { orderId: "o1" }));
unsubscribe();
console.log(seen);
```

## /outbox
Contract for a transactional outbox: `OutboxStore` with `save(event, { session, visibleAt, dedupeKey })`, `getPending`, optional `claimPending` / `claimPendingFenced` (lease with `consumerId`, `leaseMs`, `types`), `acknowledge`, `fail(id, error, { retryAt, deadLetter })`, `getDeadLettered`, `purge`, `requeue`, `countByStatus`, `oldestPendingAgeMs`. `transactionalSave: true` declares that `save` enlists the session.
- Status values: `OUTBOX_STATUSES` (`pending`, `delivered`, `dead_letter`).
- Errors: `OutboxOwnershipError` (ack or fail by a non-owner), `OutboxConflictError` (same id, different payload), `InvalidOutboxEventError`. `outboxPayloadFingerprint(event)`.
- `OutboxFailurePolicy` decides retry or dead-letter from `{ event, error, attempts }`.

## /memory-outbox
`new MemoryOutboxStore()` implements `OutboxStore` for tests and dev; extra helpers `all()`, `clear()`.

```ts
import { createEvent } from "@classytic/primitives/events";
import { MemoryOutboxStore } from "@classytic/primitives/memory-outbox";

const outbox = new MemoryOutboxStore();
await outbox.save(createEvent("order.placed", { orderId: "o1" }, { id: "evt_1" }));
const claimed = await outbox.claimPending({ limit: 10, consumerId: "worker-1" });
await outbox.acknowledge("evt_1", { consumerId: "worker-1" });
console.log(claimed.length, await outbox.countByStatus("delivered"));
```

## /durable-events
For money and stock events that must not be lost. A durable type may only be written as an outbox row inside a unit of work.
- `durableEventMeta(name, version, occurrence)` -> `{ id, idempotencyKey }` with a deterministic id (`name:v1:occurrence`); the occurrence is the aggregate id plus step, never just the order.
- A durable dispatch needs a session and an outbox that declares `transactionalSave: true` (`MemoryOutboxStore` does not; subclass it in tests).
- `requireDurableContext({ name, durability }, ctx)` throws `NonDurablePublishError` (code `events.non_durable_publish`) or `UnmanagedSessionError`.
- `dispatchDomainEvent({ outbox, transport, label, dispatch? }, { session, pending }, event, durability)` saves to the outbox first, then publishes inline (acknowledging) or defers when `pending` is given. Outcomes: `deferred`, `committed`, `relay`, `published`, `publish_failed`, `no_transport`.
- `flushDeferredEvents(channels, pending)` after the unit of work commits; returns a map of event id to error or null.
- `DurableEventSpec<P>` declares `durability` and `occurrence(payload)`; `FactExpectation` lets a consumer name the facts an event must produce.

```ts
import { dispatchDomainEvent, durableEventMeta, flushDeferredEvents } from "@classytic/primitives/durable-events";
import { createInProcessBus } from "@classytic/primitives/event-infra";
import { createEvent, type DomainEvent } from "@classytic/primitives/events";
import { MemoryOutboxStore } from "@classytic/primitives/memory-outbox";

class TransactionalOutbox extends MemoryOutboxStore {
  readonly transactionalSave = true;
}

const channels = { outbox: new TransactionalOutbox(), transport: createInProcessBus(), label: "orders" };
const event = createEvent("order.shipped", { orderId: "o1" }, durableEventMeta("order.shipped", 1, "o1"));
const pending: DomainEvent[] = [];
const outcome = await dispatchDomainEvent(channels, { session: { id: "txn-1" }, pending }, event, "durable");
console.log(outcome, [...(await flushDeferredEvents(channels, pending))]);
```
