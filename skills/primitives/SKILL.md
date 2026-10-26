---
name: primitives
description: "Shared domain primitives, imported by subpath: integer minor-unit Money, civil dates and timezones, domain events and outbox, state machines, status history, approval chains, idempotency, phone and OTP, stock quantities, SLA. Use before hand-rolling any of these. Triggers: money, currency, civil date, timezone, outbox, state machine, approval, idempotency, quantity, SLA, signed token."
metadata:
  minVersion: "0.34.0"
---

# primitives

Zero-dependency, ESM, Node 22+. Pure functions over plain data; no root barrel, import each subpath.

## Do not hand-roll

| Need | API (subpath) |
|---|---|
| Money math without floats | `addMoney`, `fromMajor`, `sumMoney` (`/money`) |
| Split a total with no penny drift | `allocate`, `allocateDiscount` (`/split-allocation`) |
| FX conversion | `convertWithSnapshot` (`/currency`) |
| Price by weight, time or rate card | `resolvePriceBasisTotal` (`/price-basis`), `priceUsage` (`/usage-pricing`) |
| Fractional unit cost | `unitCostRateFromTotal`, `extendedAmount` (`/unit-cost-rate`) |
| Calendar day in a zone, due dates | `civilDateOf`, `addCivilDays`, `civilDateToInstant` (`/timezone`) |
| Month, quarter, fiscal ranges | `resolveMonth`, `resolvePeriod`, `fiscalYearOf` (`/period`) |
| Holiday tables with coverage | `defineDateEdition`, `lookupDateFact` (`/calendar-facts`) |
| Recurrence rules | `nextOccurrence` (`/cadence`) |
| Response and breach targets | `breachedAt` (`/sla`), `evaluateSLAStatus` (`/sla-policy`) |
| Promise timeout | `withDeadline` (`/deadline`) |
| Event envelope | `createEvent`, `createChildEvent` (`/events`) |
| Dev bus, test outbox | `createInProcessBus` (`/event-infra`), `MemoryOutboxStore` (`/memory-outbox`) |
| Durable emit in a transaction | `durableEventMeta`, `dispatchDomainEvent` (`/durable-events`) |
| Status lifecycle | `defineStateMachine`, `assertAndClaim` (`/state-machine`) |
| Status audit trail | `appendStatus`, `timeInStatus` (`/status-history`) |
| Maker-checker approvals | `createChain`, `applyDecision`, `assertApproved` (`/approval`) |
| Safe request retries | `decideClaim`, `completeClaim` (`/idempotency`) |
| Blocks on an entity | `addHold`, `isOnHold` (`/hold`) |
| Phone, OTP, names | `parsePhone` (`/phone`), `createOtpChallenge` (`/otp`), `formatDisplayName` (`/person`) |
| Decimal stock quantities and keys | `addQuantity` (`/quantity`), `stockKeyOf` (`/item-identity`), `sellable` (`/stock-level`) |
| Partial receipt or fulfilment | `planSettlement` (`/line-settlement`) |
| Signed tokens, stable hashes | `signToken`, `verifyToken` (`/signed-token`), `canonicalDigest` (`/canonical`) |
| CSV cells, env config | `escapeCsvCell` (`/csv`), `readEnv` (`/environment`) |

## Golden path

```ts
import { allocate } from "@classytic/primitives/split-allocation";
import { addMoney, fromMajor } from "@classytic/primitives/money";

const total = addMoney(fromMajor(19.99, "USD"), fromMajor(5, "USD")); // { amount: 2499, currency: "USD" }
const parts = allocate(1000, [{ id: "a", weight: 2 }, { id: "b", weight: 3 }], "by-weight"); // sums to 1000
```

```ts
import { addCivilDays, civilDateOf, civilDateToInstant } from "@classytic/primitives/timezone";

const today = civilDateOf(new Date(), "Asia/Dhaka"); // "YYYY-MM-DD"
const due = addCivilDays(today, 7);
const dueAt = civilDateToInstant(due, "Asia/Dhaka"); // local midnight, DST-exact
```

```ts
import { defineStateMachine } from "@classytic/primitives/state-machine";
import { appendStatus } from "@classytic/primitives/status-history";

const machine = defineStateMachine<"draft" | "placed" | "paid">({
  name: "order",
  transitions: { draft: ["placed"], placed: ["paid"], paid: [] },
});
machine.assertTransition("o1", "draft", "placed"); // throws IllegalTransitionError otherwise
const history = appendStatus([], "placed", { by: "u1" }); // new array; never mutate
```

```ts
import { createEvent } from "@classytic/primitives/events";
import { createInProcessBus } from "@classytic/primitives/event-infra";

const bus = createInProcessBus();
await bus.subscribe("order.*", (event) => { console.log(event.type); });
await bus.publish(createEvent("order.placed", { orderId: "o1" }, { organizationId: "org1" }));
```

## Gotchas

- Money `amount` is an integer in minor units; mixed currencies throw `CurrencyMismatchError`.
- Day math uses `CivilDate` strings plus an IANA zone; `/calendar` takes a fixed offset and ignores DST.
- `/deadline` is a promise timeout; `/sla`, `/sla-policy`, `/period`, `/cadence` work in instants.
- `/retention` is a purge record (`PurgeEvidence`), not a TTL policy.
- A state with an empty target list is terminal. `assertAndClaim` returns `null` when another writer won.
- `parsePhone` and `planSettlement` return a `Result`; `verifyToken` returns `{ ok: false, reason }`. None throw.
- A durable event needs `transactionalSave` on the outbox and a session, else `NonDurablePublishError`.
- `skuRef` is the stock key; `sku` is a label. Use `stockKeyOf`.
- `classifyEnv` maps unknown values to `development`.
- Pagination, tenant config and error contracts live in `@classytic/repo-core`.

## Never

- Floats or `toFixed` for money; per-line rounding of a split total.
- Local-machine `Date` getters for business days; month-end math with `setMonth`.
- A hand-written `findOneAndUpdate({ status })` guard instead of a state machine.
- Deep imports (`dist/`, `src/`) or reading `node_modules` for the API.

## References

- `references/money.md`: read for money, currency, allocation, unit cost, proration.
- `references/pricing.md`: read for monetization kinds, price basis, usage rating.
- `references/payments.md`: read for payment events, gateway shapes, bank data.
- `references/time.md`: read for civil dates, periods, fiscal years, holidays.
- `references/scheduling.md`: read for cadence, SLA, shelf life, suspension.
- `references/events.md`: read for event bus, outbox, durable dispatch.
- `references/workflow.md`: read for state machines, history, holds, conditions.
- `references/approval-idempotency.md`: read for approval chains and request claims.
- `references/identity.md`: read for names, phone, OTP, verification, subject refs.
- `references/address.md`: read for address formats, validation, geofences.
- `references/inventory.md`: read for quantities, stock keys, settlement.
- `references/foundations.md`: read for Result, brand, context, env, fault.
- `references/security-data.md`: read for signed tokens, canonical JSON, CSV, purge records.
