# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
adhering to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
