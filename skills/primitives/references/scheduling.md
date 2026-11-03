# Scheduling: cadence, SLA, deadlines, shelf life, suspension

Subpaths: `/cadence`, `/sla`, `/sla-policy`, `/deadline`, `/concurrency`, `/shelf-life`, `/suspension`. These work in instants (`Date`) and milliseconds. For calendar-day due dates use civil dates (`references/time.md`).

## /cadence
Recurrence rules: `daily`, `weekly` (`daysOfWeek`, ISO 1 to 7), `monthly` (`dayOfMonth`), `yearly` (`month`, `dayOfMonth`), `cron`. Every cadence has `interval`, `startAt`, optional `endAt` and `timezone`.
- `validateCadence(c)` throws `CadenceError` with a `code`.
- `nextOccurrence(c, from)` -> next `Date` after `from`, or `null` when ended. `occurrencesBetween(c, from, to, limit?)`.

```ts
import { nextOccurrence, occurrencesBetween, type Cadence } from "@classytic/primitives/cadence";

const weekly: Cadence = { kind: "weekly", interval: 1, startAt: new Date("2026-01-01T09:00:00Z"), daysOfWeek: [1, 3], timezone: "UTC" };
console.log(nextOccurrence(weekly, new Date("2026-01-05T10:00:00Z")), occurrencesBetween(weekly, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-15T00:00:00Z")));
```

## /sla
A target duration with a breach policy (`warn`, `escalate`, `block`): `{ targetDurationMs, breachPolicy, label? }`.
- `breachedAt(sla, startedAt)`, `remainingMs(sla, startedAt, now?)`, `elapsedMs(startedAt, now?)`, `isBreached`, `consumedFraction` (0 to 1 and beyond), `validateSLA` (throws `SLAError`).

```ts
import { breachedAt, consumedFraction, isBreached } from "@classytic/primitives/sla";

const sla = { targetDurationMs: 4 * 3600_000, breachPolicy: "escalate" as const };
const started = new Date("2026-01-01T00:00:00Z");
console.log(breachedAt(sla, started), isBreached(sla, started, new Date("2026-01-01T05:00:00Z")), consumedFraction(sla, started, new Date("2026-01-01T02:00:00Z")));
```

## /sla-policy
Per-priority targets plus optional working hours.
- `defineSLAPolicy({ name, priorities: { high: { firstResponseMs, rollingResponseMs } }, defaultPriority, workingHours? })` validates (throws `SLAPolicyError`).
- `deriveFirstResponseSLA(policy, priority?)`, `deriveRollingResponseSLA(...)` give a plain `SLA`.
- `evaluateSLAStatus(policy, { priority, startedAt, firstRespondedAt, lastRespondedAt }, now?)` -> `{ kind, responseBy, remainingMs, breached }`; kinds `FirstResponseDue`, `FirstResponseFulfilled`, `RollingResponseDue`, `Failed`.
- `WorkingHours`: `weekdays`, `startMinute`, `endMinute`, `timezone?`, `holidays?`. `isWithinWorkingHours(policy, instant)`.

## /deadline
`withDeadline(promise, timeoutMs, label)` rejects with `DeadlineExceededError` after the timeout. It is a promise timeout, not a due-date calculator.

## /concurrency
- `mapBounded(items, concurrency, fn)`: at most `concurrency` calls in flight, results in input order. The first rejection stops new work and rejects after in-flight calls settle. Below 1 runs one at a time, `Infinity` runs all, `NaN` throws `RangeError` (an unset `Number(process.env.X)` must not flood).
- `chunked(items, size)`: consecutive chunks; throws `RangeError` unless `size` is an integer >= 1.

## /shelf-life
Lot or serial expiry dates. Policy: `{ mode: 'none'|'lot'|'serial', useExpiration, shelfLifeDays?, bestBeforeDays?, removalDays?, alertDays? }`.
- `validateShelfLifePolicy`, `isTracked`, `isExpiryTracked`, `deriveShelfLifeDates(receivedAt, policy, { expiresAt? })` -> `{ expiresAt, bestBeforeDate, removalDate, alertDate }`, `shelfLifeStatus(dates, asOf)` -> `none | fresh | alert | removed | expired`. Errors: `ShelfLifeError`.

```ts
import { deriveShelfLifeDates, shelfLifeStatus } from "@classytic/primitives/shelf-life";

const dates = deriveShelfLifeDates(new Date("2026-01-01T00:00:00Z"), { mode: "lot", useExpiration: true, shelfLifeDays: 30, alertDays: 7 });
console.log(dates, shelfLifeStatus(dates, new Date("2026-01-28T00:00:00Z")));
```

## /suspension
Pause rules with a period allowance and notice.
- `evaluateSuspension(request, history, policy, { offsetMinutes })` -> `{ allowed, reason, message, autoResumeAt, daysUsedInPeriod, daysRemainingInPeriod }`. Refusals: `not_allowed`, `allowance_exhausted`, `below_minimum`, `above_maximum`, `already_suspended`, `insufficient_notice`; approval reason is `approved`.
- Policy: `allowed`, `maxDaysPerPeriod`, `periodMonths`, `minDays`, `maxDays`, `maxConcurrent`, `noticeDays`, `creditsWindow`.
- `allowancePeriod(at, periodMonths?, offset?)`, `suspendedDaysInPeriod(history, period, at?)`, `openSpans`, `dueForAutoResume(span, at)`, `spansFromStatusHistory(history, pausedStatus, opts)` builds spans from a `/status-history` list.

```ts
import { evaluateSuspension } from "@classytic/primitives/suspension";

const decision = evaluateSuspension(
  { startsAt: new Date("2026-03-01T00:00:00Z"), endsAt: new Date("2026-03-11T00:00:00Z"), requestedAt: new Date("2026-02-01T00:00:00Z") },
  [],
  { allowed: true, maxDaysPerPeriod: 30, periodMonths: 12, noticeDays: 7 },
);
console.log(decision.reason, decision.daysRemainingInPeriod);
```
