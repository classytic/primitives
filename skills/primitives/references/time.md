# Time: civil dates, zones, periods, calendar facts

Subpaths: `/timezone`, `/period`, `/calendar`, `/calendar-facts`. Rule: a calendar day is a `CivilDate` string (`YYYY-MM-DD`) in an IANA zone; an instant is a `Date`. Convert at the edge, never with local-machine `Date` methods.

## /timezone
- `CivilDate` is a branded string. `civilDate('2026-03-31')` validates (throws `TimeZoneError` on a bad or impossible date); `isCivilDate` guards.
- `civilDateOf(instant, zone)` -> the local calendar day. `civilDateToInstant(cd, zone, { hour, minute })` -> local midnight by default, DST-exact.
- `addCivilDays(cd, n)`, `civilDaysBetween(a, b)`, `isoWeekOfCivilDate(cd)` (`2026-W14`).
- `localTimeParts(instant, zone)` -> `{ isoWeekday, hour, minute, minutesOfDay }`; `zoneOffsetMinutes(instant, zone)`, `zoneOffsetLabel`, `isValidTimeZone(zone)`, `listTimeZones()`.
- There is no civil-month arithmetic here; write it on top of these helpers.

```ts
import { addCivilDays, civilDate, civilDateOf, civilDateToInstant } from "@classytic/primitives/timezone";

const due = addCivilDays(civilDateOf(new Date("2026-03-31T20:00:00Z"), "Asia/Dhaka"), 7);
console.log(due, civilDateToInstant(civilDate("2026-03-31"), "Asia/Dhaka"));
```

## /period
Instant ranges (`DateRange`: `start` inclusive, `end` exclusive) resolved in a zone.
- Resolve: `resolveDay`, `resolveMonth(year, month, zone)`, `resolveQuarter`, `resolveYear`, `resolveDateSpan(from, to, zone)` (inclusive civil days), `resolveFiscalYear(startYear, { startMonth, timezone })`, `fiscalYearOf(date, opts)` -> `{ startYear, label, range }`, `dayStart(date, zone)`.
- `Period` is `{ year, month? | quarter?, timezone? }` or `{ year, start, end }`. `resolvePeriod(period, zone?)` throws `PeriodError` (`MISSING_TIMEZONE`, `AMBIGUOUS_PERIOD`, ...) when no zone is known.
- Labels: `parsePeriod('2026-Q2', zone)`, `formatPeriod(p)` (`2026-03`, `2026-Q3`), `periodOf(instant, 'month', zone)`, `shiftPeriod(p, n)`, `granularityOf`, `periodTimeZone`.
- Ranges: `isWithin(d, range)`, `rangesOverlap` (touching ranges do not overlap), `rangeDurationMs`, `inclusiveEnd(range)` (last millisecond), `isDateRange`. Errors: `DateRangeError`.

```ts
import { formatPeriod, resolveMonth, resolvePeriod } from "@classytic/primitives/period";

console.log(resolveMonth(2026, 2, "Asia/Dhaka"), resolvePeriod({ year: 2026, quarter: 1 }, "UTC"), formatPeriod({ year: 2026, month: 3 }));
```

## /calendar
Instant helpers with a fixed UTC offset in minutes (no DST). Prefer `/timezone` for zone-aware work.
- `startOfDay(instant, offsetMinutes?)`, `startOfMonth`, `isoWeekday(instant, offsetMinutes?)` (1 Monday to 7 Sunday).
- `addDays(instant, n)` is exactly n * 24h. `addMonths(instant, n)` and `addYears` work in UTC and clamp the day (Jan 31 + 1 month = Feb 28 or 29).

## /calendar-facts
Attributed lookup tables of dated facts (public holidays, employer closures) with explicit coverage, so "not listed" and "unknown" differ.
- `defineDateEdition({ year, coverage: { from, through }, authority: { issuer, reference }, dates: [{ date, entry }] })` validates and throws `InvalidDateEditionError` listing `problems`.
- `defineDateFactCalendar({ timeZone, editions: { '2026': edition } })`.
- `lookupDateFact(calendar, civilDate)` and `lookupDateFactAt(calendar, instant)` return `{ kind: 'listed', entry }`, `{ kind: 'not-listed' }` or `{ kind: 'unknown', reason }` (`missing-edition`, `outside-coverage`, `unattested`).
- Ready entry types: `PublicHolidayEntry`, `PublicHolidayCalendar`, `EmployerClosureEntry`.

```ts
import { defineDateEdition, defineDateFactCalendar, lookupDateFact } from "@classytic/primitives/calendar-facts";
import { civilDate } from "@classytic/primitives/timezone";

const edition = defineDateEdition({
  year: "2026",
  coverage: { from: "2026-01-01", through: "2026-12-31" },
  authority: { issuer: "Ministry", reference: "Gazette 12/2026" },
  dates: [{ date: "2026-12-16", entry: { label: "National day" } }],
});
const calendar = defineDateFactCalendar({ timeZone: "Asia/Dhaka", editions: { "2026": edition } });
console.log(lookupDateFact(calendar, civilDate("2026-12-16")), lookupDateFact(calendar, civilDate("2027-01-02")));
```
