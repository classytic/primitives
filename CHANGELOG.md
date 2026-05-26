# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
adhering to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-05-26

### Added — payment domain primitives

Three new subpaths shared across every payment-aware package
(`@classytic/invoice`, `@classytic/revenue`, `@classytic/order`, future
POS / AP / subscription packages). Each ships under a flat subpath so
consumers tree-shake what they don't import.

- **`/payment-method-kind`** — `PaymentMethodKind` universal vocabulary
  (kind vs host-registered `methodCode`) so packages can speak `kind`
  while hosts speak `code`.
- **`/payment-allocation-status`** — orthogonal allocation +
  reconciliation status enums for payment legs (`unallocated`,
  `partial`, `allocated`, `over_allocated`, plus reconciliation states).
- **`/payment-events`** — pure TS payload contracts for payment domain
  events. Wire-only (no Zod, no runtime). Anchored on `Money` +
  `PaymentMethodKind`; causation/correlation stay on `EventMeta`.

No breaking changes.

## [0.6.0] - 2026-05-17

### Added — five new primitives for CRM / workflow domains

Five new primitives covering gaps the existing surface didn't address.
Each ships under its own flat subpath import (no breaking changes).

- **`/phone`** — `PhoneNumber` value object + `parsePhone(input)` that
  normalizes free-form input to E.164, captures the country calling code
  as a discrete field, and reports failures via `Result<PhoneNumber,
  PhoneError>`. Zero external deps; ITU-T E.164 prefixes inlined. Hosts
  that want region-of-issue / line-type detection layer on top with
  libphonenumber-js.

- **`/status-history`** — Generic, immutable status-change log:
  `StatusChangeEntry<TStatus>`, `appendStatus()`, `timeInStatus()`,
  `lastTransitionTo()`. Captures `durationInPriorMs` at write time so
  funnel-velocity dashboards ("avg time in Qualification") work without
  re-walking timestamps. Pairs naturally with `/state-machine`.

- **`/condition`** — Tiny JSON-serializable predicate DSL: `FieldCondition`
  (`{ field, op, value }`) composed via `AllCondition` / `AnyCondition`
  / `NotCondition`, plus a total `evaluate(condition, target)` and a
  `validateCondition()` for boot-time schema checks. Powers SLA scope
  filters, drip "if opened/clicked" branches, automation triggers, and
  permission row-scopes — anywhere a predicate needs to round-trip
  through a database.

- **`/mixin`** — Additive type composition without subclassing:
  `withMixin<T, K, M>()` / `getMixin()` / `hasMixin()` / `withoutMixin()`.
  Lets a `Contact` carry per-domain payloads (`mixins.customer`,
  `mixins.lead-fit`) on a typed `mixins` namespace without bloating the
  base type. Plain object composition — no decorators, no global
  hierarchy, no proxies.

- **`/sla-policy`** — Higher-order SLA layered on the existing `/sla`:
  priority matrix (`urgent` / `high` / `normal` → durations), first-
  response vs rolling-response semantics, and working-hours window
  (weekdays + start/end minute + holidays). `defineSLAPolicy()` validates
  at boot; `evaluateSLAStatus()` produces `{ kind, responseBy,
  remainingMs, breached }` from a policy + per-entity inputs. The
  existing simple `/sla` interface is unchanged — `sla-policy` derives
  concrete `SLA` instances from a policy + priority and delegates to it.

### Changed — source-tree reorganization (no public-surface impact)

The 24 primitive source files moved from a flat `src/*.ts` layout into
six category folders so the package is self-documenting at the file
system level:

```
src/
  money/           money, currency, split-allocation, bank-transaction, payment-gateway
  identity/        person, address, phone
  scheduling/      period, cadence, sla, sla-policy
  workflow/        state-machine, status-history, approval, hold, condition
  events/          events, outbox
  composition/     mixin, reference, context, brand, result
```

**Public subpath imports are unchanged** — `@classytic/primitives/money`,
`@classytic/primitives/sla`, etc. still resolve. tsdown emits each entry
to `dist/<name>.mjs` regardless of source nesting. Existing consumers
upgrade with `npm install @classytic/primitives@^0.6.0` and a no-op
diff.

### Dependencies

Still zero runtime deps. Node 22+.

## [0.5.0] - 2026-05-05

### Added — `/bank-transaction` subpath

Canonical bank-feed shapes shared across `@classytic/fin-io` (parsers
produce these), `@classytic/revenue` (`transactionRepository.import()`
consumes them), and `@classytic/ledger` (`bankStatementMapper`
consumes them). Single source of truth for the cross-package
vocabulary; eliminates the structural mirrors fin-io and revenue
were carrying.

Exports: `BankTransaction`, `BankCounterparty`, `BankAccount`,
`BankStatement`, `BankStatementSource`, `BankImportReport`,
`BankImportRowError`. All anchored on `Money` from `/money` (integer
minor units, `number`).

### Added — `/payment-gateway` subpath

Canonical payment-gateway data shapes. **Lets any provider package
(Stripe, Razorpay, SSLCommerz, PayPal, bKash, Nagad, manual, …)
implement against primitives' types without depending on revenue's
heavyweight runtime.** Provider authors peer-dep on
`@classytic/primitives` only.

Exports: `CreateIntentParams`, `PaymentIntent`, `PaymentResult`,
`RefundResult`, `WebhookEvent`, `ProviderCapabilities`. All `amount`
fields are `Money` from `/money` (no flat `amount: number, currency:
string` pairs — currency travels inside Money).

The `PaymentProvider` abstract class — the *contract* every provider
must satisfy — stays in `@classytic/revenue`. Revenue is the data
engine that consumes providers; provider packages live elsewhere.

### Architectural intent

Revenue 3.0 + primitives 0.5 + fin-io 0.3 establish a clean
three-tier seam:

  1. **primitives** — pure data shapes (no runtime, no deps). Owns
     `Money`, `BankTransaction`, `PaymentIntent`, every cross-
     package vocabulary type.
  2. **revenue** — the engine. Owns the abstract contracts
     (`PaymentProvider`, `BankFeedProvider`), state machines, repos.
     Consumes primitives shapes.
  3. **provider packages** (`revenue-stripe`, `revenue-razorpay`,
     `@classytic/fin-io/adapters/revenue`, …) — implementations.
     Peer-dep on primitives. Optional peer-dep on revenue for the
     abstract base class.

This eliminates the cycle where every provider package transitively
pulled mongoose + mongokit just to know what a `PaymentIntent`
looked like. Tree-shaking, build times, and dep-graph honesty all
improve.

### Migration

Consumers MUST import from primitives subpaths. No re-exports from
revenue or fin-io (PACKAGE_RULES P2):

```ts
// Before
import type { PaymentIntent, CreateIntentParams } from '@classytic/revenue';
import type { CanonicalTransaction, Money } from '@classytic/fin-io';

// After
import type {
  PaymentIntent,
  CreateIntentParams,
} from '@classytic/primitives/payment-gateway';
import type { BankTransaction } from '@classytic/primitives/bank-transaction';
import type { Money } from '@classytic/primitives/money';
```

Provider helper classes (`PaymentIntent`, `PaymentResult`,
`RefundResult`, `WebhookEvent`) are deleted from revenue — they were
trivial wrappers around plain objects. Provider implementations now
return plain object literals matching the interface.

`CreateIntentParams.amount` is now `Money` (`{ amount: number,
currency: string }`), not the flat `amount + currency` pair. Revenue's
repository wraps internally:

```ts
const intent = await provider.createIntent({
  amount: { amount: params.amount, currency },
  metadata: params.metadata,
  ...params.paymentData,
});
```

## [0.3.1] - 2026-05-02

### Added — state-machine ↔ mongokit/sqlitekit integration

State-machine primitives now compose directly with the kit-level CAS surface shipped in mongokit 3.13 and the sqlitekit follow-up. Three additions:

- **`StateMachine.validTargets(from)`** — every status the aggregate can move TO from `from`. Useful for UI dropdowns ("which actions are legal right now?") and for fanning a single source state into a multi-source CAS via a repo's `claim({ from: machine.validTargets(current), to })`.
- **`StateMachine.validSources(to)`** — every status that can transition INTO `to` (reverse adjacency). Pair with a repo's multi-source `claim({ from: machine.validSources(to), to })` when the target is fixed but the caller doesn't yet know the current state — the canonical "cancel from any non-terminal" / "error from any in-flight" pattern. Pre-computed at definition time, O(1) lookup, frozen arrays safe to expose by reference.
- **`assertAndClaim(machine, repo, id, args)`** — pairs `machine.assertTransition` (sync domain check) with `repo.claim()` (atomic CAS) in one call. The canonical state-machine-backed CAS pattern. Skipping either layer leaves a hole: skip `assertTransition` and bad transitions reach storage; skip `claim` and concurrent writers race.

```ts
import { defineStateMachine, assertAndClaim } from '@classytic/primitives/state-machine';

const ORDER_MACHINE = defineStateMachine<OrderStatus>({
  name: 'Order',
  transitions: {
    draft:     ['approved', 'cancelled'],
    approved:  ['shipped', 'cancelled'],
    shipped:   [],
    cancelled: [],
  },
});

// Single-source:
const updated = await assertAndClaim(ORDER_MACHINE, orderRepo, orderId, {
  from: 'draft',
  to: 'approved',
  patch: { approvedAt: new Date() },
  options: { organizationId: ctx.organizationId, session },
});

// Multi-source via reverse adjacency — "cancel from any legal predecessor":
await assertAndClaim(ORDER_MACHINE, orderRepo, orderId, {
  from: ORDER_MACHINE.validSources('cancelled'), // ['draft', 'approved']
  to: 'cancelled',
  patch: { cancelledAt: new Date() },
  options: { organizationId: ctx.organizationId },
});
```

#### `ClaimableRepo<TDoc>` — structural dependency on the kit

`assertAndClaim` accepts any object matching `ClaimableRepo<TDoc>` — a structural type that mirrors the mongokit 3.13 `Repository.claim()` signature. Primitives doesn't take a hard peer dep on mongokit; consumers wire the kit they want. Sqlitekit's `claim()` matches the same shape (verified by mongokit/sqlitekit cross-conformance).

```ts
export interface ClaimableRepo<TDoc> {
  claim(
    id: string,
    transition: {
      field?: string;
      from: unknown | readonly unknown[];
      to: unknown;
      where?: Record<string, unknown>;
    },
    patch?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<TDoc | null>;
}
```

#### Why a 0.3.1 (not 0.4.0)

Purely additive — no removals, no signature changes. `defineStateMachine` callers from 0.3.0 see two new methods on the returned `StateMachine` (`validTargets`, `validSources`) and one new free function (`assertAndClaim`). Backwards-compatible.

## [0.3.0] - 2026-04-29

### Removed — `/errors` subpath (BREAKING)

- Deleted `@classytic/primitives/errors` (`ErrorContract`, `ErrorDetail`, `ErrorCode`, `ERROR_CODES`).
- Errors are infrastructure-shaped (HTTP-coupled, repository-coupled, RFC 7807-shaped). Moved to `@classytic/repo-core/errors` where they sit next to `pagination`, `tenant`, `cache`, `hooks`, `schema` — every other repository contract — and join the existing `HttpError` throwable contract there. Single canonical home for both the wire (`ErrorContract`) and throwable (`HttpError`) shapes.

#### Migration

```diff
- import type { ErrorContract, ErrorDetail, ErrorCode } from '@classytic/primitives/errors';
- import { ERROR_CODES } from '@classytic/primitives/errors';
+ import type { ErrorContract, ErrorDetail, ErrorCode } from '@classytic/repo-core/errors';
+ import { ERROR_CODES } from '@classytic/repo-core/errors';
```

Field shapes and code values are unchanged — pure relocation.

### Removed — `/tenant` subpath (BREAKING)

- Deleted `@classytic/primitives/tenant` (`TenantConfig`, `TenantStrategy`, `TenantFieldType`, `DEFAULT_TENANT_CONFIG`, `resolveTenantConfig`, `ResolvedTenantConfig`).
- Tenant scope is **infrastructure-shaped** (describes how queries get scoped to a database / repository), not a domain primitive like Money or Address. Moved to `@classytic/repo-core/tenant` where it sits next to `context`, `filter`, `hooks`, `schema`, `cache` — every other repository contract.
- Mongokit and sqlitekit already peer-dep `@classytic/repo-core`, so consuming `TenantConfig` from there costs zero extra peer deps for those kits.

#### Migration

```diff
- import type { TenantConfig } from '@classytic/primitives/tenant';
- import { resolveTenantConfig, DEFAULT_TENANT_CONFIG } from '@classytic/primitives/tenant';
+ import type { TenantConfig } from '@classytic/repo-core/tenant';
+ import { resolveTenantConfig, DEFAULT_TENANT_CONFIG } from '@classytic/repo-core/tenant';
```

Field shapes, runtime semantics, and defaults are unchanged. The custom-strategy escape hatch (`strategy: 'custom'` + `resolve: (ctx) => filterShape`) works identically.

### Removed — `/pagination` subpath (BREAKING)

- Deleted `@classytic/primitives/pagination` (`PageParams`, `KeysetParams`, `SortSpec`, `SortDirection`, `OffsetPage<T>`, `KeysetPage<T>`, `AggregatePage<T>`, `emptyOffsetPage`, `emptyKeysetPage`).
- Pagination shapes are owned by **`@classytic/repo-core/pagination`** — that package ships both the types AND the cursor encoding/skip-math/keyset-validation algorithms. Primitives' duplicate type-only declarations existed before the contract was canonised in repo-core; keeping them invited drift.

### Migration

```diff
- import type { OffsetPage, KeysetPage, AggregatePage, SortSpec } from '@classytic/primitives/pagination';
+ import type {
+   OffsetPaginationResult,
+   KeysetPaginationResult,
+   AggregatePaginationResult,
+   SortSpec,
+ } from '@classytic/repo-core/pagination';
```

Note: shape names also changed (`OffsetPage` → `OffsetPaginationResult`, etc.) to match repo-core's naming. Field names align with what mongokit, sqlitekit, and arc already produced — those packages always returned repo-core shapes; primitives' types were a parallel, never-quite-aligned vocabulary.

If you also need HTTP wire envelopes (`{ success: true } & Result`), repo-core 0.3.0 ships `OffsetPaginationResponse`, `KeysetPaginationResponse`, `AggregatePaginationResponse`, `BareListResponse`, `PaginatedResponse`, plus a `toCanonicalList()` runtime normalizer.

### Why now (and why this is the only breaking change in this release)

Two layers of pagination shapes drifted across the org: primitives declared one set, repo-core declared a different set, mongokit + sqlitekit + arc all consumed repo-core's. Removing primitives' set is purely subtractive — nobody internally imports from `@classytic/primitives/pagination`, and external consumers get a clear migration path to repo-core. No new ground to break later.

## [0.2.0]

### Added

- **`/state-machine` subpath** — `defineStateMachine<TStatus>({ name, transitions, errorFactory? })`
  declarative state-transition primitive. Replaces hand-rolled
  `if (status === 'X') throw` blocks across kernels:

  ```typescript
  import { defineStateMachine } from '@classytic/primitives/state-machine';

  const ORDER_MACHINE = defineStateMachine<OrderStatus>({
    name: 'Order',
    transitions: {
      draft: ['approved', 'cancelled'],
      approved: ['shipped', 'cancelled'],
      shipped: [],
      cancelled: [],
    },
  });

  ORDER_MACHINE.assertTransition('order-1', 'draft', 'approved'); // OK
  ORDER_MACHINE.assertTransition('order-1', 'shipped', 'draft');  // throws
  ORDER_MACHINE.canTransition('draft', 'shipped');                // false
  ORDER_MACHINE.isTerminal('shipped');                            // true
  ```

  Generic over the status string-union — `Record<TStatus, readonly TStatus[]>`
  on `transitions` enforces exhaustiveness at the call site. Kernels with their
  own typed transition error class (e.g. flow's `InvalidTransitionError`) wire
  it via `errorFactory` so the thrown type stays domain-consistent. Standalone
  callers get the bundled `IllegalTransitionError` (carries `entityType` /
  `entityId` / `from` / `to` + `code: 'illegal_transition'` + `status: 422`).

  First consumer: `@classytic/flow` `PROCUREMENT_MACHINE` (procurement-order
  approve / cancel transitions).

## [0.1.1]

### Added

- **`MinorUnits<C>` branded type on `/money`** — wire-format monetary amount
  (integer minor units, branded with phantom currency) for HTTP/JSON fields
  where a full `Money` struct is overkill. Erases at runtime; `MinorUnits<'BDT'>`
  vs `MinorUnits<'USD'>` collide at compile time. Pair with structured `Money`
  for in-process arithmetic. Constructor: `MinorUnits(amount, currency?)`.

### Changed

- **`/tenant` `contextKey` cascade default** — `resolveTenantConfig({ tenantField: 'branchId' })`
  now defaults `contextKey` to `'branchId'` instead of `'organizationId'`.
  When a host renames `tenantField`, their `OperationContext` carries the id
  under the same key in the overwhelming majority of cases; mirroring the
  rename is the least-surprise default. Explicit `contextKey` still overrides
  (set when the doc field and context key genuinely diverge). Existing call
  sites that supplied both `tenantField` and `contextKey` are unaffected.

## [0.1.0]

Initial release. Framework-agnostic TypeScript primitives shared across
Classytic packages. Zero runtime dependencies. Node 22+. ESM only.
260 tests (unit + integration) across 20 files.

All subpaths are importable independently; there is **no root barrel
re-export** — consumers must use subpath imports (`@classytic/primitives/money`,
`/events`, `/tenant`, …) to keep the Node ESM loader + TypeScript compiler
from walking the full module graph on any convenience import.

### Subpaths

- **`/money`** — `Money` type + integer-minor-unit arithmetic (`money`,
  `addMoney`, `subtractMoney`, `multiplyMoney`, `sumMoney`, `negateMoney`,
  `absMoney`, `compareMoney`, `equalsMoney`, `isZeroMoney`, `isPositiveMoney`,
  `isNegativeMoney`, `isMoney`, `fromMajor`, `toMajor`); `CurrencyMismatchError`.
- **`/currency`** — `CurrencyCode` brand; `CURRENCIES` table; `MINOR_UNIT_FACTOR`,
  `minorUnitFactor`, `isCurrencyCode`, `toCurrencyCode`.
- **`/address`** — `Address`, `ContactAddress`, `GeoPoint`, `GeoJsonPoint`;
  `toGeoJsonPoint`, `fromGeoJsonPoint`.
- **`/period`** — `DateRange`, `Period`; `isDateRange`, `isWithin`,
  `rangeDurationMs`.
- **`/pagination`** — `PageParams`, `OffsetPage<T>`, `KeysetPage<T>`,
  `AggregatePage`, `KeysetParams`, `SortSpec`, `SortDirection`;
  `emptyOffsetPage`, `emptyKeysetPage`.
- **`/reference`** — `ExternalRef`, `DocumentRef`, `ObjectIdLike`, `IdLike`;
  `idToString`, `isExternalRef`.
- **`/context`** — `OperationContext` (the identity + tracing bag every
  Classytic package accepts); `ActorRef`.
- **`/events`** — `EventMeta` (arc v2.9-aligned — 13 fields including
  `schemaVersion`, `causationId`, `partitionKey`, `source`, `idempotencyKey`,
  `aggregate`), `DomainEvent<T>`, `EventTransport`, `EventHandler`,
  `EventLogger`, `DeadLetteredEvent<T>`, `PublishManyResult`; `createEvent`,
  `createChildEvent` (auto-chains `causationId`, inherits `correlationId` /
  `userId` / `organizationId` / `source` / `idempotencyKey` — NOT
  `aggregate`), `matchEventPattern`.
- **`/outbox`** — transactional outbox **contract** mirrored from arc v2.9:
  `OutboxStore`, `OutboxWriteOptions`, `OutboxClaimOptions`,
  `OutboxAcknowledgeOptions`, `OutboxFailOptions`, `OutboxErrorInfo`,
  `OutboxFailureContext`, `OutboxFailureDecision`, `OutboxFailurePolicy`;
  `OutboxOwnershipError`, `InvalidOutboxEventError`. **Contract only** —
  runtime (`EventOutbox`, `MemoryOutboxStore`, `MongoOutboxStore`,
  `exponentialBackoff`) ships in `@classytic/arc/events` and
  `@classytic/arc/events/mongo`. Domain packages implement `OutboxStore`
  without peer-depping arc.
- **`/tenant`** — `TenantConfig` (with `strategy: 'field' | 'none' | 'custom'`
  and optional `resolve(ctx)` for custom strategy), `TenantFieldType`,
  `TenantStrategy`, `ResolvedTenantConfig`; `DEFAULT_TENANT_CONFIG`,
  `resolveTenantConfig`. Field names match `@classytic/mongokit`'s
  `MultiTenantOptions` so a resolved config threads into
  `multiTenantPlugin({ ... })` without translation.
- **`/result`** — `Result<T, E>`; `ok`, `err`, `isOk`, `isErr`, `unwrap`,
  `mapResult`, `mapError`.
- **`/brand`** — `Brand<T, B>`, `Prettify`, `DeepPartial`, `DeepReadonly`,
  `RequireKeys`, `OptionalKeys`, `NonEmptyArray`.
- **`/errors`** — `ErrorContract`, `ErrorDetail`, `ErrorCode`, `ERROR_CODES`.
- **`/split-allocation`** — `allocate(total, subjects, method)` returns a
  `SplitResult` whose parts sum exactly to `total` via the largest-remainder
  method. Methods: `equal`, `by-qty`, `by-weight`, `by-volume`, `by-value`,
  `by-percent`. Deterministic — identical inputs produce identical outputs;
  ties broken by input order. Handles negative totals by sign-flipping.
  Exports: `allocate`, `isBalanced`, `SplitAllocationError`, types
  `SplitMethod`, `SplitSubject`, `SplitPart`, `SplitResult`,
  `SplitAllocationErrorCode`.
- **`/approval`** — `ApprovalChain` value object with pure FSM helpers.
  Supports sequential and parallel chains, per-step quorum
  (`requiredApprovals`), threshold-gated skips. Any step-level rejection
  rejects the chain; all steps `approved`|`skipped` approves it. Exports:
  `createChain`, `applyDecision`, `skipStep`, `nextPendingStep`,
  `pendingSteps`, `isApproved`, `isRejected`, `isPending`, `decisionCount`,
  `ApprovalError`, types `ApprovalChain`, `ApprovalStep`, `ApprovalDecision`,
  `Approver`, `ApprovalStatus`, `ChainOrder`, `ApprovalThreshold`,
  `CreateChainInput`, `CreateStepInput`, `DecisionInput`, `ApprovalErrorCode`.
- **`/cadence`** — recurrence spec with pure UTC date arithmetic. Kinds:
  `daily`, `weekly`, `monthly`, `yearly`, `cron` (opaque — host parses).
  `dayOfMonth: 31` snaps to the last day of shorter months; Feb 29 snaps
  to Feb 28 in non-leap years. Exports: `nextOccurrence`,
  `occurrencesBetween`, `validateCadence`, `CadenceError`, types `Cadence`,
  `DailyCadence`, `WeeklyCadence`, `MonthlyCadence`, `YearlyCadence`,
  `CronCadence`, `CadenceKind`, `IsoWeekday`, `CadenceErrorCode`.
- **`/hold`** — `HoldReason` + collection helpers. Host embeds
  `HoldReason[]` on documents. Exports: `addHold`, `resolveHold`,
  `activeHolds`, `resolvedHolds`, `isOnHold`, `hasActiveHoldOfCode`,
  `HoldError`, types `HoldReason`, `HoldActor`, `HoldActorKind`,
  `AddHoldInput`, `ResolveHoldInput`, `HoldErrorCode`.
- **`/sla`** — target duration + breach-detection arithmetic. Policy is
  carried but not executed — host reads `breachPolicy` (`warn` | `escalate`
  | `block`) and acts. Exports: `breachedAt`, `remainingMs`, `elapsedMs`,
  `isBreached`, `consumedFraction`, `validateSLA`, `SLAError`, types
  `SLA`, `BreachPolicy`, `SLAErrorCode`.
- **`/person`** — person/contact shapes shared across order, crm, hr.
  `PersonName`, `ContactInfo`, `EmergencyContact`, `Gender`; formatters
  `formatFullName`, `formatDisplayName`.

### Design principles

- Pure functions on plain data. No I/O, no Mongo, no events.
- Immutable return values. Helpers return new collections; originals are never mutated.
- Deterministic. Same inputs → same outputs. Clock sources injected
  explicitly so tests don't flake.
- Errors are typed. Every module ships an `<Name>Error` class with a
  discriminated `code: <Name>ErrorCode` string union.
- Subpath-imports only — no root barrel.

### Ownership direction

Arc is the source of truth for event types. Primitives **mirrors** arc
(`@classytic/arc/events/EventTransport.ts`, `@classytic/arc/events/outbox.ts`)
verbatim for `EventMeta`, `DomainEvent`, `EventTransport`,
`DeadLetteredEvent`, `EventLogger`, `PublishManyResult`, and the full
`OutboxStore` contract surface. Helpers (`createEvent`, `createChildEvent`)
are allowed to be more defensive but match arc's signatures.

Packages that peer-dep `@classytic/primitives` can write
`class FooOutboxRepository implements OutboxStore` without pulling arc into
their dependency graph; hosts import `EventOutbox` + `MongoOutboxStore` from
arc and wire them against package-provided stores.
