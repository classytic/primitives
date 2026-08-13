# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
adhering to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.22.0] - 2026-08-12

### Added — `./period`: `shiftPeriod(period, n)` — calendar arithmetic without instants

Shift a MONTH or QUARTER period by `n` of its own units (negative = back); YEAR shifts by years; a `custom` (ad-hoc start/end) period has no unit to shift and throws rather than guessing one. No `Date` is constructed and no zone is consulted — shifting a month is pure `(year, month)` arithmetic, and the `timezone` rides along unchanged so the shifted period still resolves against the calendar it was defined in.

Exists because both inline shapes callers reach for are wrong the same way: `new Date(Date.UTC(y, m - 1 - n, 1))` answers a business-calendar question with a UTC instant (six hours off at both ends in Asia/Dhaka — the bug class this module's header documents five instances of), and hand-rolled `y * 12 + (m - 1) - n` integer math is a third copy of a rule `Period` already owns, with the year rollover exactly where copies go wrong. First consumer: be-prod `business-date.ts` ("two filing months ago").

**Versioning note:** this export briefly existed in a working copy labelled 0.21.0 after 0.21.0 had already been published without it — same version, different surface. 0.22.0 restores the invariant that a version number names exactly one contract; `>=0.22.0` is the correct floor for any consumer importing `shiftPeriod`.

### Docs — `./environment` docblock refinement (no API change)

The 0.21.0 entry below originally listed `isProduction` / `isDevelopment` / `isTest`; the published surface is `classifyEnv`, `EnvClass`, `isProductionEnv` only — `isProductionEnv` is deliberately the single predicate (consumers needing all three buckets build their own triple from `classifyEnv`). The entry below is corrected in place; runtime and declarations are byte-identical to published 0.21.0 apart from comments.

## [0.21.0] - 2026-08-10

### Added — `./environment`: canonical `NODE_ENV` classification

`classifyEnv(raw)` — total function mapping a raw `NODE_ENV` string to `EnvClass = 'development' | 'test' | 'production'`. Every input yields exactly one bucket; no fourth state or `undefined`. Handles both spellings per bucket (`production`/`prod`, `test`/`qa`), trims whitespace (`.env` files and CI variables routinely carry trailing newlines), and defaults unknown values to `development` — the safe-fail direction that keeps local tooling functional.

Collapses four copies across the codebase that each missed at least one spelling: `be-prod classifyEnv`, `gym businessMode()`, arc's CLI config template (`z.preprocess`), and arc's four raw comparison sites. The missed spellings were all in the dangerous direction — a `NODE_ENV=prod` instance that matched nothing fell through to `development`, opening security gates (`Secure` cookie flag, arc's dev preset, non-transactional money writes, raw 500 messages to the client) in production.

Exports: `classifyEnv`, `EnvClass`, `isProductionEnv`.

### Added — `publint` gate on build

`publint: true` in `tsdown.config.ts` — catches export-map entries pointing at non-existent dist files at build time rather than at consumer install time.

## [0.20.0] - 2026-08-05

### Added — `./period` OWNS timezone-aware period resolution (was two copies above the kernels)

`Period` was `{ year, month?, quarter? }` with no timezone and no resolver, so it
could not express "the business month of August in Asia/Dhaka". The resolver
existed TWICE, both ABOVE the kernels — `@spinekit/kit/period`
(`createBusinessCalendar`) and be-prod's `#lib/utils/business-date` — which meant
a kernel could reach neither and re-derived the boundary inline with `Date.UTC`.
Five silent UTC-month defects came out of that (`aggregateMonthlyVat`, the
sales-fact reconciler, and three in bd-tax Mushak).

This is a MOVE of the proven `createBusinessCalendar` logic, not a re-derivation:
same civil-date round-trip through `/timezone`, same half-open ranges, same
DST-exactness.

- **`Period.timezone?`** — the IANA zone a period is DEFINED in, so a persisted or
  transported period keeps its own calendar.
- **`resolvePeriod(period, timezone?)`** → half-open `DateRange`. Throws when no
  zone is available anywhere (never silently answers in UTC) and throws when the
  period's zone and the caller's zone DISAGREE.
- **`resolveDay` / `resolveMonth` / `resolveQuarter` / `resolveYear` /
  `resolveDateSpan` / `dayStart`** — the granularity-specific forms. All return
  HALF-OPEN `[start, end)`, which tiles exactly.
- **`periodOf(instant, granularity, timezone)`** — the inverse: which filing
  period an instant belongs to on the LOCAL calendar.
- **`parsePeriod` / `formatPeriod` / `granularityOf` / `periodTimeZone`** —
  `'YYYY'` · `'YYYY-MM'` · `'YYYY-Qn'`. `parsePeriod` REFUSES a `'YYYY-MM-DD'`
  rather than reading it as its month (a ~30× widening).
- **`inclusiveEnd(range)`** — `end - 1ms` for legacy `$lte` call sites, derived
  from the resolved end so it stays DST-exact.
- **`PeriodError`** + **`PeriodErrorCode`** (`AMBIGUOUS_PERIOD` ·
  `INCOMPLETE_RANGE` · `INVALID_FIELD` · `MISSING_TIMEZONE` · `TIMEZONE_CONFLICT`
  · `INVALID_LABEL`).

A `Period` carrying two resolution shapes (`month` + `quarter`, or either with
`start`/`end`) now throws instead of preferring one.

### Added — `./idempotency`: the claim + lease CONTRACT

Three kernels hand-rolled incompatible versions of one state machine — `cart`
(`in_flight`/`succeeded`/`failed`, the only one with crash-window leasing),
`catalog` offers (`pending`/`completed`, no lease), `contract` amendments
(implicit). Types + PURE helpers only; no persistence, no collection, no driver.

- **`ClaimOutcome = 'claimed' | 'replayed' | 'in_flight'`** — three-valued, and
  `in_flight` is NOT a failure. Mapping a live concurrent lease onto an error
  licenses a retry, which is a double-apply.
- **`IdempotencyClaim`** (`identity` · `requestFingerprint` · `state` ·
  `leaseToken` · `leaseExpiresAt` · `attempts` · `result`), **`ClaimResult`**,
  **`ClaimState`**, **`IdempotencyIdentity`**.
- **`decideClaim(existing, request)`** — the whole state machine as one pure
  function. Throws `FINGERPRINT_MISMATCH` (same key, different body) and
  `MISSING_REPLAY` (terminal record with no stored result) rather than answering.
- **`completeClaim` / `renewLease`** — both refuse when the caller lost its lease,
  so a superseded attempt cannot overwrite the winner's result.
- **`identityKey`** (canonical-JSON composite, so a delimiter inside a scope value
  cannot collide two identities), **`fingerprintRequest`**, **`newLeaseToken`**,
  **`isLeaseExpired`**, **`holdsLease`**, **`isInFlight`**, **`DEFAULT_LEASE_MS`**.

### Changed — BREAKING: five API decisions taken before spine wiring starts

- **`./cadence` — `Cadence.timezone` is now AUTHORITATIVE, not display-only.**
  It was documented as decorative while `stepMonthly`/`stepYearly` used
  `getUTCMonth()`/`getUTCDate()`, so `timezone: 'Asia/Dhaka'` + `dayOfMonth: 1`
  with a midnight anchor placed every occurrence on the local **2nd**. All four
  kinds now run on the zone's wall clock when one is set (daily advances LOCAL
  days — 23h/25h across a DST transition), and stay UTC when it is absent.
  `validateCadence` rejects an unresolvable zone with the new
  `INVALID_TIMEZONE`. **Behavioural change for any persisted cadence that
  already carries a `timezone`** — the occurrences move to where the field
  always claimed they were.
- **`./approval` — `assertApproved` no longer passes on a `null` chain.** It now
  throws the new `CHAIN_MISSING`. Absence is not approval, and a mongoose schema
  that never declared `approvalChain` strips it on write, so the gate could not
  tell "no approval configured" from "approval silently lost". The explicit
  opt-out is the new **`assertApprovedIfPresent`**. The second parameter is now
  an options object (`{ message }`), not a bare string.
- **`./payment-events` — every payload carries an `eventType` discriminant, and
  there is a `payment.unknown` event.** `PaymentInitiatedPayload` and
  `PaymentSucceededPayload` were structurally IDENTICAL with no discriminant on
  the union, so a handler typed for "funds received" accepted "money in flight".
  Adds **`PaymentUnknownPayload`** (the port contract's third outcome had no
  event, so an unobserved result had to be forced into SUCCEEDED or FAILED),
  **`PaymentEventPayloadMap`**, **`isPaymentEvent`**, **`isFundsReceived`**, and
  three compile-time drift guards over the map.
- **`./currency` — `convertWithSnapshot` / `reverseWithSnapshot` take and return
  `Money`.** A bare `number` meant nothing checked the amount was denominated in
  `fx.sourceCurrency`; a USD→BDT snapshot applied to a EUR amount type-checked
  and returned a plausible wrong number. Both now throw `CurrencyMismatchError`
  on a mismatch, handle differing minor-unit exponents (USD 2 → JPY 0), and take
  an explicit **`FxRounding`** (`'half-away-from-zero'` default · `'floor'` ·
  `'ceil'`) instead of returning an unrounded float for each caller to round
  differently.
- **`./money` — `Money.currency` is `CurrencyCode`, not `CurrencyCode | string`.**
  A union with `string` collapses to `string`, so the brand was decoration on
  the one type where it matters and `money()` validated nothing. `money()`,
  `fromMajor()` and `sumMoney()` now validate and brand; `isMoney` format-checks
  the code instead of `typeof === 'string'`. New **`currencyCode(value)`**
  (throwing constructor) and **`InvalidCurrencyCodeError`**.
  **`CurrencyMismatchError` is now DECLARED in `./currency`** (so the FX seam can
  throw it without an ESM cycle) and re-exported from `./money`, so existing
  imports are unaffected.

Migration: a `Money` object literal now needs a branded code —
`money(1999, 'USD')`, or `{ amount: 1999, currency: currencyCode('USD') }`.

### Changed — six silent-permissiveness defects now FAIL instead of answering

Every item below previously returned a plausible-looking value where it should
have errored. All are behaviour changes for malformed input only; correct input
is unaffected. Falsifying tests live in `tests/unit/fail-loud-regressions.test.ts`.

- **`./period` — an Invalid Date no longer reports "no overlap".** `rangesOverlap`,
  `isWithin` and `rangeDurationMs` throw the new `DateRangeError` on a non-finite
  endpoint; `isDateRange` returns `false` for one. Every comparison against `NaN`
  is `false`, so a corrupt range used to answer "no conflict" — the PERMISSIVE
  answer for the three documented consumers (order booking collision, flow
  reservation-window collision, promo campaign overlap), i.e. a silent double-book.
- **`./currency` — the ISO 4217 exponent table is now exhaustive.** All 0-decimal
  (`BIF CLP DJF GNF ISK KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF`), 3-decimal
  (`BHD IQD JOD KWD LYD OMR TND`) and 4-decimal (`CLF UYW`) currencies are listed,
  so `minorUnitFactor`'s `?? 100` fallback is reachable only by a code that is not
  a real ISO currency. Previously `fromMajor(1500, 'GNF')` stored 150 000 minor
  units — a 100× error that looks like a number. New `isKnownCurrency(code)`
  distinguishes "listed" from "assumed" for boot-time config validation.
- **`./proration` — a missing allocated part throws instead of becoming `0`.** The
  `?? 0` fallbacks in `splitByPeriodFraction` / `allocateMoneyByFraction` are now
  `ProrationError('ALLOCATION_INVARIANT')`. A zero credit and a genuinely
  fully-consumed period were indistinguishable downstream.
- **`./state-machine` — `assertAndClaim` rejects an EMPTY `from` list.**
  `validSources(to)` returns `[]` for an unreachable status, and the documented
  `from: machine.validSources(x)` idiom then ran the assert loop zero times and
  handed the CAS an empty allow-list. An empty allow-list must never mean "any".
- **`./timezone` — the offset regex is anchored.** An offset label the runtime
  emits in an unexpected shape (e.g. an unpadded `GMT+5:30`) matched the optional
  bare-`GMT` branch and resolved to **UTC**, silently shifting every business-day
  boundary derived from it. Unrecognised labels now throw; `\d{1,2}` accepts the
  unpadded variant rather than mis-reading it.
- **`./canonical` — class instances are rejected, not collapsed.** A
  `Types.ObjectId`, `Buffer` or hydrated Mongoose subdocument has no own
  enumerable keys, so it digested as `{}` and two manifests referencing DIFFERENT
  documents hashed identically — the integrity check reported "unchanged".
  `canonicalJson` now throws `CanonicalizeError` for any object whose prototype is
  neither `Object.prototype` nor `null`. Plain objects, null-prototype objects,
  arrays and `Date` are unaffected.

### Changed — the publish smoke gate now sweeps the whole export map

`tests/smoke/smoke.mjs` derives its subpath list from `package.json#exports`
(44/44) instead of a hand-maintained list that covered 23, and asserts each entry
declares both `types` and `default` and that both files exist. The gate runs in
`prepublishOnly`; previously a subpath that lost its tsdown entry would have
published an export map pointing at a missing file with the gate printing OK.

## [0.19.0] - 2026-08-01

### Added — `./monetization`: canonical pricing classification contract

- **`@classytic/primitives/monetization`** — the single home for how a product
  is sold and priced, so the classification survives end-to-end across catalog,
  revenue, order, and entitlement kernels without each maintaining its own enum.
- **`Monetization`** discriminated union — `FreeMonetization | OneTimeMonetization |
  SubscriptionMonetization | BundleMonetization | UsageMonetization`, each
  carrying its own nested pricing shape.
- **`MONETIZATION_KINDS`** + **`MonetizationKind`** + **`isMonetizationKind`** —
  exhaustive kind list with runtime guard.
- Type-guard predicates: **`isFreeMonetization`**, **`isOneTimeMonetization`**,
  **`isSubscriptionMonetization`**, **`isBundleMonetization`**,
  **`isUsageMonetization`**.
- Supporting types: `PriceTier`, `OneTimePricing`, `SubscriptionPlan`,
  `UsageTier`, `UsageRating`, `DurationUnit`, `MoneyByCurrency`.

### Added — `./proration`: pure proration arithmetic

- **`@classytic/primitives/proration`** — timezone-agnostic, policy-free
  proration math. Holds no commercial policy (no upgrade/downgrade semantics,
  no discount or tax logic) — those live in the contract kernel.
- **`periodProgress(input)`** — fraction of a billing period consumed given
  start, end, and current instants as `Date`. Returns `PeriodFraction`.
- **`splitByPeriodFraction(amount, fraction, granularity?)`** — split a `Money`
  amount into consumed/remaining parts; `granularity: 'whole_day'` (default) or
  `'exact'`.
- **`allocateMoneyByFraction(amount, fraction)`** — proportional allocation
  using the largest-remainder allocator so `consumed + remaining === amount`
  exactly (no penny drift).
- **`ProrationError`** + **`ProrationErrorCode`** (`INVALID_PERIOD` |
  `INVALID_FRACTION`) — typed errors for out-of-range inputs.
- Supporting types: `PeriodFraction`, `PeriodProgressInput`,
  `ProrationGranularity`.

## [0.18.0] - 2026-07-29

### Added — `./subject`: `SubjectRef` polymorphic identity pointer

- **`@classytic/primitives/subject`** — `SubjectRef` (`{ subjectModel, subjectRef }`) — WHO a record is about, polymorphically. The pairing spans every kernel that holds data about a person without owning them (attendance, access, loyalty, credentials). Deliberately kept distinct from `ExternalRef` (provenance — "came from") even though the shapes are identical: a grant carries both at once and they mean different things.
- **`buildSubjectRef(model, id)`** — returns `SubjectRef | null`; `null` when `id` is absent/blank, because a malformed binding silently matches nothing (an entitlement nobody holds, a credential no revoke can find) rather than carrying `"undefined"` as a string.
- **`SubjectRef`** type exported from `@classytic/primitives/subject`.

### Added — `./state-diagram`: Mermaid diagram from a `StateMachine`

- **`@classytic/primitives/state-diagram`** — `renderStateDiagram(machine, opts?)` — generates a `stateDiagram-v2` Mermaid string from the same `StateMachine` object the runtime CAS enforces. Removes the class of drift where a hand-drawn prose comment diverges from the actual transition table. Pure: string in, string out, no I/O.
- **`StateDiagramOptions`** — `title?`, `highlight?` (mark specific states), `noteOn?` (per-state annotations).

### Added — `./suspension`: time-bounded suspension/pause policy

- **`@classytic/primitives/suspension`** — pure suspension policy computation (no persistence). Models a pause the subject is ENTITLED to take, bounded by an annual allowance, that ends by itself — distinct from `/hold` (an indefinite blocker needing manual resolution).
- **`evaluateSuspension(policy, history, opts)`** — always returns `autoResumeAt` (the instant the pause MUST end) so a sweep can resume it whether or not the subject ever comes back. Covers: gym membership freeze, subscription pause, unpaid leave.
- **`SuspensionPolicy`** — `maxDaysPerPeriod`, `minDurationDays`, `period` ('annual' | 'rolling').
- **`SuspensionEntry`** — a historical pause record (`startedAt`, `endedAt?`, `reason?`).
- **`SuspensionResult`** — `autoResumeAt`, `daysUsed`, `daysRemaining`, `status`.

### Added — `OutboxStore.transactionalSave` (`/outbox`)

- **`OutboxStore.transactionalSave?: boolean`** — declares whether `save` enlists `options.session` in the caller's transaction. Absent/`false` = "assume NOT atomic". Set `true` ONLY when `save` passes the session to the same transactional resource the caller writes (e.g. a mongoose model on the same connection). Callers that need atomicity (`@classytic/access`'s `atomically()`) check this flag and fail at boot rather than claiming a guarantee they cannot keep.
- **`MemoryOutboxStore.transactionalSave = false`** — explicitly declared; an in-memory store cannot participate in a Mongo transaction, so its write survives a rollback.

### Changed — `shelf-life.ts` deduplicates `addDays`

- `addDays` is now imported from `./calendar` instead of being re-defined inline. No behavior change.

## [0.16.0] - 2026-07-27

### Added — `assertApproved` + `CHAIN_INCOMPLETE` (`/approval`)

- **`ApprovalErrorCode` gains `'CHAIN_INCOMPLETE'`** — the single canonical
  error code for "finalize/commit attempted before the chain reached `approved`".
  Hosts route it through `rethrowApprovalError` to the `approval.chain_incomplete`
  wire code so all commit/post/finalize boundaries raise the same structured error.
- **`assertApproved(chain, message?)`** — canonical finalize-time gate: asserts
  the chain has reached `approved`, else throws `ApprovalError('CHAIN_INCOMPLETE')`.
  A `null`/absent chain passes (no chain required). Use at every journal-entry
  post, PO approve, transfer dispatch, etc. to replace per-domain hand-rolled
  divergent codes with one definition.

Purely additive — no existing exports changed.

## [0.15.0] - 2026-07-25

### Added — `/retention`: `PurgeEvidence` value object

- **New `@classytic/primitives/retention` subpath** exporting **`PurgeEvidence`**
  — the persisted evidence record for a GDPR / data-retention purge operation
  (proof of what was purged, over what scope, by whom, why, and whether
  analytical measures were retained). Shape: `{ id, subject: { ref, model? },
  scope, strategy: 'hard'|'soft'|'anonymize', measuresRetained, processed,
  occurredAt, actor: { ref, kind: 'user'|'system'|'service' }, reason,
  legalBasis?, status: 'completed'|'partial'|'failed', operationId?,
  startedAt?, completedAt?, results?: PurgeResourceResult[],
  verification?: PurgeVerificationSummary }`.
- **`createPurgeEvidence(input)`** — pure builder (auto-fills `id` + `occurredAt`
  when absent, defaults `status` to `'completed'`). **`isPurgeEvidence(value)`**
  type guard + **`assertPurgeEvidence(value)`** throwing assertion.

### Added — `/canonical`: strict deterministic JSON + integrity digest

- **New `@classytic/primitives/canonical` subpath** — `canonicalJson(value)`
  produces a deterministic string (keys sorted recursively, `Date` → `{"$date":"<iso>"}`,
  strict rejection of `undefined`/`NaN`/`BigInt`/`Map`/`Set`/cycles with
  `CanonicalizeError`). **`sha256Hex(input)`** and **`canonicalDigest(value)`**
  (= `sha256Hex(canonicalJson(value))`) — integrity checksums, not tamper-proof
  seals. Uses `node:crypto` directly (same precedent as `/otp`).

### Added — `/event-infra`: `propagateHandlerErrors` option

- **`InProcessEventBusOptions.propagateHandlerErrors?: boolean`** (default
  `false` — existing error-isolating behavior unchanged). When `true`, `publish`
  runs handlers sequentially and rethrows the first handler error to the
  publisher — for single-consumer projection/relay lanes where a failed handler
  must not be silently acked. `publishMany` maps each event's failure into its
  `PublishManyResult` entry instead of rejecting the batch.

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
