# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
adhering to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.17.0] - 2026-07-24

### Added — `/canonical`: strict deterministic JSON + integrity digest

- **New `@classytic/primitives/canonical` subpath** — cross-domain vocabulary
  for STABLE checksums of structured data. `canonicalJson(value)` produces a
  deterministic string: keys sorted recursively (order-invariant), `Date`
  serialized explicitly as `{"$date":"<iso>"}` (so timestamps participate in
  the digest instead of collapsing to `{}` under a naive `JSON.stringify`), and
  STRICT rejection of ambiguous/non-portable values — `undefined`, `NaN`/
  `Infinity`, `BigInt`, `function`, `symbol`, `Map`, `Set`, cyclic refs, invalid
  `Date` — with a `CanonicalizeError`. Plus `sha256Hex(input)` and
  `canonicalDigest(value)` (= `sha256Hex(canonicalJson(value))`).
- These are integrity CHECKSUMS (corruption + drift detection), not tamper-proof
  seals. Uses `node:crypto` directly — precedent: `/otp` already does; the
  zero-dependency policy covers third-party deps, not Node built-ins.
- Consolidates a canonicalizer that had appeared in `@classytic/arc/cleanup`;
  now two domains (cleanup manifests, financial-close evidence manifests) share
  one implementation. Strictly additive — a brand-new subpath.

## [0.16.0] - 2026-07-24

### Added — `/retention`: `PurgeEvidence` value object

- **New `@classytic/primitives/retention` subpath** exporting **`PurgeEvidence`**
  — the persisted evidence record for a GDPR / data-retention purge operation
  (proof of what was purged, over what scope, by whom, why, and whether
  analytical measures were retained). Shape: `{ id, subject: { ref, model? },
  scope, strategy: 'hard'|'soft'|'anonymize', measuresRetained, processed,
  occurredAt, actor: { ref, kind: 'user'|'system'|'service' }, reason,
  legalBasis? }`. The `strategy` enum is a SUBSET of repo-core's
  `TenantPurgeStrategy['type']` (no `skip` — a skipped purge produces no
  evidence; no `custom`).
- **`createPurgeEvidence(input)`** — pure builder; auto-fills `id`
  (`crypto.randomUUID` with an RFC-4122 v4 fallback) and `occurredAt` only when
  absent, invoked at call time (never at module load), mirroring `createEvent`.
- **`isPurgeEvidence(value)`** type guard + **`assertPurgeEvidence(value)`**
  throwing assertion — structural validation following the package's
  zero-dependency convention (`isExternalRef`, `isBankTransaction`, ...). Note:
  primitives ships no runtime schema library (no Zod); hosts derive a schema at
  their edge from the exported `PurgeEvidence` type.
- **Cleanup-design §6.1 hardening.** `PurgeEvidence` now also carries a required
  **`status: 'completed' | 'partial' | 'failed'`** (builder defaults `completed`),
  optional **`operationId`** (correlate many evidence rows to one run), optional
  distinguished **`startedAt` / `completedAt`** (alongside the canonical
  `occurredAt`), optional per-resource **`results: PurgeResourceResult[]`**
  (`{ resource, processed, ok, error? }`), and optional **`verification:
  PurgeVerificationSummary`** (`{ ok, checks?, note? }`) — so a multi-step
  cleanup's evidence records exactly how far it got and what it verified.
- **Guard tightened** (`isPurgeEvidence`): required labels (`scope`, `reason`,
  `subject.ref`, `actor.ref`, plus `operationId`/`legalBasis`/`model` when
  present) must be NON-EMPTY; `processed` (and per-resource `processed`,
  `verification.checks`) must be INTEGERS; the new `status` enum, `results`
  array, `verification` object, and `startedAt`/`completedAt` dates are
  validated. Closes the guard-vs-Zod divergence (the guard previously accepted
  empty strings and fractional counts the validation schema rejected).
- **Legal-hold doc fix:** a legal hold PREVENTS a purge (it is not a purge
  trigger), so it never produces evidence — corrected the header comment.
- Unit tests (`tests/unit/purge-evidence.test.ts`, 19) + smoke-test coverage
  for the `./retention` subpath. Cross-package guard↔Zod agreement fixtures live
  in `@classytic/validation`'s `retention.test.ts`.

Strictly additive to existing records EXCEPT the new required `status` (builder
defaults it, so `createPurgeEvidence` callers are unaffected; only hand-built
records must add it).

## [0.15.0] - 2026-07-24

### Added — `/event-infra`: `propagateHandlerErrors` option (strict projection lanes)

- **`InProcessEventBusOptions.propagateHandlerErrors?: boolean`** (default
  `false` — existing error-isolating behavior unchanged). When `true`,
  `publish` runs handlers sequentially in subscription order and RETHROWS
  the first handler error to the publisher instead of catch-log-continue.
  For SINGLE-CONSUMER projection/relay lanes (outbox relay → one projector):
  a thrown handler error must fail the delivery so the relay retries /
  backs off / dead-letters, rather than silently acking unprocessed work.
  Later matching subscribers are skipped on failure (documented — do not
  use on shared multi-subscriber operational buses). Nothing is logged on
  the strict path; `publishMany` keeps its contract and maps each event's
  failure into its `PublishManyResult` entry instead of rejecting the
  batch. Strictly additive — default construction is byte-identical to
  0.14.0 behavior.

### Added — `/money`: scalar minor-unit helpers (ledger dialect)

- **`majorToMinorUnits(major, minorUnitDecimals = 2)` /
  `minorUnitsToMajor(minor, minorUnitDecimals = 2)` /
  `percentOfMinor(minor, ratePercent)` / `formatMinorUnits(minor,
  minorUnitDecimals = 2)`** — the currency-neutral, exponent-based scalar
  dialect used by the double-entry ledger family, extracted from
  `@classytic/ledger/money` (`fromDecimal`/`toDecimal`/`percentage`/
  `formatPlain`) so the math has ONE owner (PACKAGE_RULES §8.2).
  Deliberately different rounding from `fromMajor`: raw IEEE `Math.round`
  (half-up toward +∞, no `toPrecision` cleaning) — the ledger's
  characterization-tested wire behavior (`majorToMinorUnits(1.005) === 100`
  where `fromMajor(1.005,'USD').amount === 101`; `-10.5 → -10`).
  `percentOfMinor` is the EXACT multiply-then-round form (handles QST
  9.975 % without bps loss); hosts that snap rates to basis points (be-prod
  `#shared/money`) layer that policy on top before calling.

### Added — `/event-infra`: shared in-process bus + memory outbox

- **`@classytic/primitives/event-infra`** — the dependency-free reference
  event RUNTIME every kernel previously copy-pasted (26 drifted
  `in-process-bus.ts` copies + 15 `outbox-store.ts` copies across
  `commerce/packages/`, ≈1,600 lines). New subpath (not `/events` or
  `/outbox`, which stay contract-only per the settled ownership rule; arc
  keeps the DURABLE runtime — relay, `MongoOutboxStore`, backoff). Exports:
  - `InProcessEventBus` (+ `createInProcessBus`, `InProcessEventBusOptions`,
    `ErrorLogger`) — in-process fan-out `EventTransport`, structurally
    identical to arc's `MemoryEventTransport`. Union of all kernel variants:
    glob matching via `matchEventPattern`, Set-dedup across patterns,
    per-handler error isolation with injectable logger (`logger: null` =
    silent swallow, the cart dialect), `publishMany`, idempotent `close()`.
    Options: `name` (`'in-process-<kernel>'`), `logLabel` for the error line.
  - `MemoryOutboxStore` — the test/dev outbox (`save`/`getPending`/
    `acknowledge`/`purge` + `all()`/`clear()` inspection helpers). Kernels
    re-export it; production durability stays host-wired.
  - Kernels keep their public class names as thin subclasses
    (`class InProcessPosBus extends InProcessEventBus`), so no kernel API
    changes — the bus swap is internal.

### Added — `/events`: standard context→meta mapping

- **`scopedEventMeta(ctx)` + `createScopedEvent(source, type, payload, ctx?,
  meta?)` + `EventScopeContext`** — THE context→meta mapping (PACKAGE_RULES
  §8.3: `organizationId` rides META) extracted from 25 drifted per-kernel
  `events/helpers.ts` copies. `userId` ← `String(actorId)` falling back to
  `actorRef` (the commerce dialect), `organizationId` ← stringified,
  `correlationId` pass-through; absent fields omitted
  (`exactOptionalPropertyTypes`-safe). Kernel helpers become one-liners:
  `createPurchaseEvent = (t, p, ctx?, m?) =>
  createScopedEvent('@classytic/purchase', t, p, ctx, m)`.

### Changed — `EventTransport.subscribe` is now optional

- **`/events` `EventTransport.subscribe?`** — publish-only transports (outbox
  bridge adapters, host wrappers around a `publish(type, payload, meta)`
  helper, fire-and-forget pipes) now conform without casting. Hosts were
  writing `subscribe: undefined as unknown as EventTransport['subscribe']`
  literals or `as unknown as EventTransport` widenings to inject them into
  kernels that never call `subscribe` on the injected transport. Consumers
  that need in-process delivery must guard for an absent `subscribe` — the
  same "detect and fall back" contract `publishMany` and `deadLetter`
  already carry (flow's `createSettlementListener` is the reference guard;
  it has guarded `?.subscribe` since flow 0.5). Kernels subscribing on
  their OWN in-process bus are unaffected — concrete buses still implement
  `subscribe`, and a concrete method satisfies an optional member.
- Audited call sites before the change (`commerce/packages/*/src`,
  `commerce/spine/packages/*/src`): the `.subscribe` uses on injected
  transports are pass-through dispatcher methods hosts opt into (crm/party
  `dispatch.ts`), an already-guarded listener (flow's
  `createSettlementListener`), and invoice's audit bridge — which only
  subscribes when `config.audit` is wired. Each of these sources picks up a
  compile-time "possibly undefined" prompt on its NEXT rebuild against this
  version, forcing the guard (or a documented throw) exactly where a
  publish-only transport would have failed at runtime before. No published
  dist behavior changes.

## [0.13.0] - 2026-07-22

### Added — `/unit-cost-rate`: exact per-unit monetary rates (bigint-safe)

- **`@classytic/primitives/unit-cost-rate`** — fractional per-unit monetary
  rates stored as scaled integers (`scaledAmount = minorPerUnit × RATE_SCALE`,
  `RATE_SCALE = 1_000_000`). Solves the WAC / FIFO valuation problem where
  dividing a total by a fractional quantity yields a sub-minor-unit rate
  (100 paisa ÷ 3 units = 33.333… paisa/unit) that must not lose precision.
  Exports:
  - `unitCostRate(minorPerUnit, currency)` — direct rate constructor
  - `unitCostRateFromTotal(totalMinor, quantity, currency)` — WAC/FIFO
    constructor; bigint-safe, QTY_SCALE grid for fractional quantities
  - `extendedAmount(rate, qty, mode?)` — the ONE rate→total rounding boundary;
    bigint multiplication to keep large amounts exact; default `'half-even'`
    (banker's rounding), `'half-up'` available for legacy parity
  - `rateMinorPerUnit(rate)` — display helper (fractional number, NOT for math)
  - `isUnitCostRate(value)` — structural type guard
  - `UnitCostRate<C>` interface, `UnitCostRateError`, `UnitCostRateErrorCode`,
    `RoundingMode`, `RATE_SCALE`
  - For distributing a top-down charge across lines with no lost minor unit,
    compose with `allocate` from `@classytic/primitives/split-allocation`.

### Changed — `/outbox` is now the canonical contract owner

- **`@classytic/primitives/outbox` owns the transactional-outbox contract.**
  Previously this file was documented as a mirror of `@classytic/arc`'s copy
  ("arc is source of truth, keep bit-identical") while arc's docs said the
  opposite — a manual-sync drift risk. Settled: primitives owns pure
  cross-package contracts (events + outbox); arc owns runtime behavior
  (`EventOutbox` relay, stores, backoff, Fastify integration) and, from
  arc 2.24+, imports + re-exports this contract instead of duplicating it.
- **Cross-package `instanceof` now works.** Because arc re-exports these exact
  `OutboxOwnershipError` / `InvalidOutboxEventError` classes, a store built
  against primitives throws the same class identity arc's relay catches.
  Under the old duplication, arc's `instanceof` checks silently missed
  primitives-thrown ownership errors.
- No export names or signatures changed — contract surface is identical.

## [0.11.0] - 2026-07-08

### Added — eKYC vocabulary + secure OTP primitive

- **`@classytic/primitives/identity-verification`** — cross-package eKYC data shapes:
  `IdentityDocumentType`, `VerificationCheck`, `VerificationLevel`, `SubjectKind`,
  `IdentitySubject`, `DocumentReference`, `IdentityProviderCapabilities`,
  `VerificationStatus`, `CheckResult`, `CreateVerificationParams`,
  `VerificationSession`, `VerificationWebhookEvent`. Pure helpers: `isVerified`,
  `checksSatisfy`, `deriveStatus`. The identity twin of `payment-gateway` — shapes
  here, contracts in engines, provider implementations anywhere. Serves `@classytic/esign`
  (IdentityBridge port), `@classytic/payee` (ComplianceBridge), and PSP merchant KYC.
- **`@classytic/primitives/otp`** — secure OTP challenge lifecycle. Guarantees: code
  never persisted (only HMAC-SHA256 digest stored), constant-time `timingSafeEqual`
  comparison, rejection-free `randomInt` CSPRNG (no modulo bias), bounded attempt
  counter, TTL expiry, single-use verified state. Exports: `createOtpChallenge`,
  `verifyOtpChallenge`, `isOtpVerified`, `isOtpActive`. Delivery stays in
  `@classytic/notifications` — this primitive owns only the verify half.

## [0.9.1] - 2026-07-04

### Added

- **`CURRENCY_PATTERN` exported from `/currency`** — the ISO 4217 regex
  (`/^[A-Z]{3}$/`) behind `isCurrencyCode` / `toCurrencyCode`. Consumers
  embed the SAME pattern in JSON-Schema-representable validators (zod
  `.regex`, Mongoose `match`, OpenAPI `pattern`) instead of hand-rolling
  copies — `.refine(isCurrencyCode)` validates at runtime but is dropped
  by `z.toJSONSchema`, silently losing the constraint from generated API
  docs.

## [0.9.0] - 2026-07-02

### Added — `/timezone`: IANA resolution + civil dates (the door for `/calendar`'s escape hatch)

`/calendar` owns wall-clock ARITHMETIC over a fixed `UtcOffsetMinutes` and
tells hosts to "resolve the offset for the instant and pass it in" — but the
stack had no shared resolver, so consumers hand-rolled `Intl.DateTimeFormat`
(three divergent copies found: catalog ×2, be-prod POS). `/timezone` is that
resolver — zero-dep (Intl IS the ICU tz database), Temporal-shaped names for
a future mechanical migration:

- **`zoneOffsetMinutes(instant, zone)`** — per-instant, DST-exact offset;
  composes directly with `/calendar`: `startOfMonth(i, zoneOffsetMinutes(i, z))`.
- **`localTimeParts(instant, zone)`** — `{ isoWeekday, hour, minute,
  minutesOfDay }` in the zone; what pricing windows / slot grids /
  working-hours checks evaluate against (canonicalizes catalog's resolvers).
- **`CivilDate`** (branded `'YYYY-MM-DD'`) + `civilDate` / `isCivilDate` /
  `civilDateOf(instant, zone)` / `civilDateToInstant(cd, zone, time?)`
  (two-pass DST-safe) / `addCivilDays` / `civilDaysBetween` — the type for
  hotel nights, POS business dates, VAT filing years. Lexicographic ==
  chronological, so it's a range-queryable Mongo string key.
- **`isValidTimeZone(zone)`** — boot-time host-config validation;
  **`listTimeZones()`** + **`zoneOffsetLabel(instant, zone)`** — the data
  source + label for Google-Calendar-style zone pickers, straight from ICU
  (`Intl.supportedValuesOf`), no bundled list to go stale.
- `TimeZoneError`; formatter instances cached per zone.

No arithmetic here (that stays in `/calendar`) — resolution only.

## [0.7.2] - 2026-05-30

### Added — `BankTransaction` per-account routing + pending lifecycle fields

Three additive optional fields on `BankTransaction` (`/bank-transaction`):

- **`sourceAccountId?: string`** — the vendor-side account this row belongs to
  (Plaid `account_id`, Xero `BankAccount.AccountID`). Sync feeds return
  transactions spanning multiple accounts in one batch; this lets consumers
  route each row to the right account per-transaction (multi-account sync)
  instead of forcing the whole batch onto one account. Statement formats
  (single-account files) leave it undefined — the account lives on
  `BankStatement.account`.
- **`pending?: boolean`** — the entry hasn't posted/cleared yet (real-time
  feeds like Plaid `pending: true`; statement formats leave it undefined).
  Consumers must treat pending rows as provisional — don't reconcile/post
  them as final.
- **`supersedesExternalId?: string`** — set on a POSTED row that replaces an
  earlier PENDING one, carrying the pending row's `externalId` (Plaid
  `pending_transaction_id`). Pending and posted rows have different
  `externalId`s, so consumers MUST use this back-pointer to drop/replace the
  superseded pending row on ingest — otherwise both persist as duplicates.

Backward-compatible (both optional). Closes a fidelity gap where Plaid's
pending state was dropped at the canonical boundary, so downstream consumers
(`@classytic/fin-io` Plaid mapper, `@classytic/revenue` import) couldn't
distinguish provisional rows or dedupe pending→posted.

## [0.7.1] - 2026-05-26

### Added — workflow + scheduling + composition primitives

Four new flat subpaths (additive):

- **`/status-history`** — append-only status transition log primitive.
- **`/condition`** — declarative condition expressions for workflow gates.
- **`/mixin`** — composition helpers for primitive object assembly.
- **`/sla-policy`** — SLA policy definitions paired with the existing `/sla` runtime.

### Added — payment event coverage

Expanded `PAYMENT_EVENT_TYPE` catalogue to cover auth/capture and dispute
lifecycles: `AUTHORIZED`, `CAPTURED`, `AUTH_VOIDED`, `DISPUTED`,
`DISPUTE_WON`, `DISPUTE_LOST`, `SETTLED`.

`PaymentRefundedPayload` and `PaymentReversedPayload` now carry
`originalAmount` (and `reversedAmount` / `isPartial` on reversed) so
consumers can detect partial vs full operations without a follow-up
Payment lookup.

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
