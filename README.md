# @classytic/primitives

Framework-agnostic TypeScript primitives shared across Classytic packages.
Zero runtime dependencies. ESM only. Node 22+.

These are the building blocks every Classytic package speaks in common:
`Money`, `DomainEvent`, `OperationContext`, polymorphic references. When a
package duplicates one of these shapes, it drifts — this package exists so it
doesn't.

> **Canonical-contract relocations in 0.3.0.** Three modules moved out to
> `@classytic/repo-core` so kits and arc see one source of truth instead of
> two:
> - **Pagination** (`OffsetPaginationResult`, `KeysetPaginationResult`,
>   `AggregatePaginationResult`, `PaginationResult`, `toCanonicalList()`) →
>   `@classytic/repo-core/pagination`.
> - **Tenant config** (`TenantConfig`, `TenantStrategy`, `TenantFieldType`,
>   `resolveTenantConfig`, `DEFAULT_TENANT_CONFIG`, `ResolvedTenantConfig`) →
>   `@classytic/repo-core/tenant`. Mongokit and sqlitekit's
>   `MultiTenantOptions extends Pick<TenantConfig, ...>`.
> - **Error contracts** (`HttpError` throwable, `ErrorContract` wire shape,
>   `ErrorDetail`, `ErrorCode`, `ERROR_CODES`, `toErrorContract()`,
>   `statusToErrorCode()`) → `@classytic/repo-core/errors`.
>   `ArcError implements HttpError`.
>
> Events stay here. `@classytic/primitives/events` remains the canonical
> source for `EventMeta`, `DomainEvent`, `EventHandler`, `EventLogger`,
> `EventTransport`, `DeadLetteredEvent`, `PublishManyResult`, `createEvent`,
> `createChildEvent`, `matchEventPattern`. Arc 2.12 re-exports only the
> runtime `MemoryEventTransport`.

## Install

```bash
npm install @classytic/primitives
```

## Use

Prefer **subpath imports** — each concern is its own entry point, types erase
at compile time, runtime helpers are tiny.

```ts
import { addMoney, fromMajor, type Money } from '@classytic/primitives/money';
import { createEvent, type DomainEvent, type EventTransport } from '@classytic/primitives/events';
import type { OperationContext } from '@classytic/primitives/context';
import { allocate, type SplitResult } from '@classytic/primitives/split-allocation';
// Tenant config, error contracts, and pagination now live in repo-core:
import { resolveTenantConfig, type TenantConfig } from '@classytic/repo-core/tenant';
import type { HttpError, ErrorContract } from '@classytic/repo-core/errors';
import type {
  OffsetPaginationResult, KeysetPaginationResult, AggregatePaginationResult,
} from '@classytic/repo-core/pagination';
```

There is intentionally **no root barrel** — a barrel forces the Node ESM
loader and TypeScript compiler to walk every module on a single convenience
import, which slows CI and pulls unused code into the consumer's graph. Use
subpath imports only.

## What's inside

| Subpath | Ships |
|---|---|
| `/money` | `Money`, `fromMajor`, `toMajor`, `addMoney`, `subtractMoney`, `multiplyMoney`, `sumMoney`, `equalsMoney`, `compareMoney`, `negateMoney`, `absMoney`, `isMoney`, `CurrencyMismatchError` |
| `/currency` | `CurrencyCode` brand, `CURRENCIES`, `MINOR_UNIT_FACTOR`, `minorUnitFactor`, `toCurrencyCode`, `isCurrencyCode` |
| `/address` | `Address`, `ContactAddress`, `GeoPoint`, `GeoJsonPoint`, `toGeoJsonPoint`, `fromGeoJsonPoint` |
| `/period` | `DateRange`, `Period`, `isDateRange`, `isWithin`, `rangeDurationMs` |
| `/reference` | `ExternalRef`, `ObjectIdLike`, `IdLike`, `DocumentRef`, `idToString`, `isExternalRef` |
| `/context` | `OperationContext`, `ActorRef` |
| `/events` | `DomainEvent`, `EventMeta`, `EventHandler`, `EventLogger`, `EventTransport`, `DeadLetteredEvent`, `PublishManyResult`, `createEvent`, `createChildEvent`, `matchEventPattern` |
| `/result` | `Result<T, E>`, `ok`, `err`, `isOk`, `isErr`, `mapResult`, `mapError`, `unwrap` |
| `/brand` | `Brand<T, B>`, `Prettify`, `DeepPartial`, `DeepReadonly`, `RequireKeys`, `OptionalKeys`, `Nullable`, `KeysMatching`, `NonEmptyArray` |
| `/split-allocation` | `allocate`, `isBalanced`, `SplitAllocationError`, `SplitMethod`, `SplitSubject`, `SplitPart`, `SplitResult` |
| `/approval` | `createChain`, `applyDecision`, `skipStep`, `nextPendingStep`, `pendingSteps`, `isApproved`, `isRejected`, `isPending`, `decisionCount`, `ApprovalError`, `ApprovalChain`, `ApprovalStep`, `ApprovalDecision`, `Approver`, `ApprovalThreshold` |
| `/cadence` | `nextOccurrence`, `occurrencesBetween`, `validateCadence`, `CadenceError`, `Cadence`, `DailyCadence`, `WeeklyCadence`, `MonthlyCadence`, `YearlyCadence`, `CronCadence`, `IsoWeekday` |
| `/hold` | `addHold`, `resolveHold`, `activeHolds`, `resolvedHolds`, `isOnHold`, `hasActiveHoldOfCode`, `HoldError`, `HoldReason`, `HoldActor` |
| `/sla` | `breachedAt`, `remainingMs`, `elapsedMs`, `isBreached`, `consumedFraction`, `validateSLA`, `SLAError`, `SLA`, `BreachPolicy` |

## Design

### Money — integer minor units, always

```ts
import { fromMajor, addMoney, toMajor } from '@classytic/primitives/money';

const subtotal = fromMajor(19.99, 'USD');     // { amount: 1999, currency: 'USD' }
const shipping = fromMajor(5.00,  'USD');     // { amount: 500,  currency: 'USD' }
const total    = addMoney(subtotal, shipping); // { amount: 2499, currency: 'USD' }
toMajor(total);                                // 24.99
```

`Money.amount` is always an integer in the currency's minor unit — `1` = one
cent for USD, one yen for JPY, one fils for KWD. Mixing currencies throws
`CurrencyMismatchError`. This eliminates the float-rounding drift that happens
when every package rolls its own `{ amount: number, currency: string }`.

### DomainEvent — structurally identical to Arc

```ts
import { createEvent, type EventTransport } from '@classytic/primitives/events';

const event = createEvent('order:placed', { orderId: 'ord_123' }, {
  organizationId: ctx.organizationId,
  userId: ctx.actorId,
  correlationId: ctx.correlationId,
});

await transport.publish(event);
```

Shape matches `@classytic/arc`'s `DomainEvent` exactly — any Arc transport
(memory, Redis pub/sub, Redis Streams, Kafka) plugs into a package expecting
this interface without adapters. See PACKAGE_RULES.md §11.

### TenantConfig — moved to `@classytic/repo-core/tenant`

```ts
import { resolveTenantConfig } from '@classytic/repo-core/tenant';

const tenant = resolveTenantConfig(config.tenant);
// { enabled: true, tenantField: 'organizationId', fieldType: 'objectId',
//   ref: 'organization', contextKey: 'organizationId', required: true }
```

Mongokit's `MultiTenantOptions` and sqlitekit's equivalent both
`extends Pick<TenantConfig, ...>` from repo-core — pass the resolved config
straight into `multiTenantPlugin(resolved)`.

### ExternalRef — polymorphic, framework-free

```ts
interface ExternalRef {
  sourceId: string;
  sourceModel: string;
}
```

For references that cross trust boundaries (another package, another service,
Stripe, Postgres) — paired with a host-implemented `SourceBridge`. Works for
ObjectId, UUID, Stripe ID, anything. See PACKAGE_RULES.md §7.

## What's not here (on purpose)

- **Mongoose types** — use `ObjectIdLike` from `/reference`. Any Mongoose
  `Types.ObjectId` satisfies it structurally.
- **Transaction / Order / Cart shapes** — those are domain types, not
  primitives. They live in their respective packages.
- **Error subclasses** — throw plain `Error`s; hosts serialize them into
  `ErrorContract` (from `@classytic/repo-core/errors`) at the HTTP boundary
  via `toErrorContract(err)`.
- **Runtime currency database** — ship a whitelist at the app layer if you
  need one. `MINOR_UNIT_FACTOR` covers common cases.

## License

MIT © Classytic
