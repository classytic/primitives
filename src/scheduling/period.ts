/**
 * Named accounting / reporting periods, and the ONE place a `Period` becomes a
 * concrete `[start, end)` pair of instants — in a business timezone.
 *
 * ## Why the resolver lives HERE
 *
 * `Period` used to be a bare `{ year, month?, quarter? }` with no timezone and
 * no resolver, so every consumer had to answer "which instants is August?"
 * itself. Two resolvers grew ABOVE the kernels (`@spinekit/kit/period` and
 * be-prod's `business-date`), which meant a kernel could not reach either and
 * re-derived the boundary inline with `Date.UTC`. That is deterministic,
 * TZ-env-proof, reviews clean — and wrong for every deployment not sitting on
 * UTC. Asia/Dhaka is UTC+6, so a UTC month disagrees with the business month at
 * BOTH ends by six hours.
 *
 * Five documented instances of that exact bug, all silent, none of which threw:
 *
 * | where | what it did |
 * |---|---|
 * | `aggregateMonthlyVat` | reported August revenue as July AND dropped early-July revenue entirely |
 * | input-VAT aggregator | credited purchases to the wrong filing month |
 * | Mushak serial year | an invoice issued 01:00 on 1 Jan drew from the OUTGOING year's counter |
 * | sales-fact reconciler | reported total drift for every cell in every window |
 * | analytics "today" | a daily KPI wrong for six hours of every day |
 *
 * The resolution logic below is a MOVE of the proven implementation from
 * `@spinekit/kit`'s `createBusinessCalendar` — same civil-date round-trip, same
 * half-open ranges, same DST-exactness. Layers above should now bind a zone and
 * delegate rather than re-derive.
 *
 * ## DST-exactness
 *
 * Every boundary resolves through `/timezone`'s ICU civil-date primitives
 * (`civilDate` → `civilDateToInstant`), so a day is the day the local clock
 * actually had — never "the previous boundary + 24h", which is an hour off
 * twice a year in any DST zone and silently corrupts a daily rollup on exactly
 * those two days.
 */

import {
  addCivilDays,
  type CivilDate,
  civilDate,
  civilDateOf,
  civilDateToInstant,
  isValidTimeZone,
} from './timezone.js';

/**
 * A date range `[start, end]`.
 *
 * The endpoints are documented as INCLUSIVE for hand-built ranges, and
 * {@link isWithin} treats them that way. Every `resolve*` function in this
 * module instead returns a HALF-OPEN `[start, end)` range — the shape a
 * `{ $gte: start, $lt: end }` query wants, and the only shape that tiles
 * exactly (one period's `end` IS the next one's `start`, so no document is
 * counted twice and none falls in a gap). Compare against a resolved range
 * with `>= start && < end`, NOT with `isWithin`, which would accept the first
 * instant of the following period. {@link inclusiveEnd} converts when a
 * `$lte` call site genuinely needs the last instant.
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * A named accounting / reporting period.
 *
 * Exactly ONE resolution shape may be present: `month`, or `quarter`, or an
 * ad-hoc `start`+`end` pair, or none of them (meaning the whole `year`).
 * Combining them is rejected by {@link resolvePeriod} rather than silently
 * preferring one — two possible answers to "which instants is this?" is the
 * input you must not widen.
 */
export interface Period {
  /** Four-digit calendar year, e.g. 2026. */
  year: number;
  /** 1..12. */
  month?: number;
  /** 1..4. */
  quarter?: 1 | 2 | 3 | 4;
  /**
   * The IANA zone this period is DEFINED in — `'Asia/Dhaka'` for a BD filing
   * month, `'America/New_York'` for a US one. Carried on the value so a period
   * that travels (persisted on a filing, posted in a job payload, echoed in a
   * report header) keeps the calendar it was computed against instead of
   * inheriting whatever the reader's default happens to be.
   *
   * Optional because an ad-hoc `start`/`end` period needs no zone, and because
   * a caller may supply the zone at resolve time. {@link resolvePeriod} throws
   * when neither is available, and throws when the two DISAGREE.
   */
  timezone?: string;
  /** Ad-hoc override — useful when the period spans a non-calendar boundary. */
  start?: Date;
  end?: Date;
}

/** Which resolution shape a {@link Period} carries. */
export type PeriodGranularity = 'year' | 'quarter' | 'month' | 'custom';

export class DateRangeError extends Error {
  override readonly name = 'DateRangeError';
}

export type PeriodErrorCode =
  /** Two resolution shapes at once (`month` + `quarter`, or either + `start`/`end`). */
  | 'AMBIGUOUS_PERIOD'
  /** `start` without `end`, or vice versa. */
  | 'INCOMPLETE_RANGE'
  /** `year` / `month` / `quarter` outside its legal domain, or non-integer. */
  | 'INVALID_FIELD'
  /** No zone on the period and none supplied by the caller. */
  | 'MISSING_TIMEZONE'
  /** The period's own zone and the caller's zone disagree. */
  | 'TIMEZONE_CONFLICT'
  /** A `'YYYY'` / `'YYYY-MM'` / `'YYYY-Qn'` label that could not be read. */
  | 'INVALID_LABEL';

export class PeriodError extends Error {
  override readonly name = 'PeriodError';
  readonly code: PeriodErrorCode;

  constructor(code: PeriodErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Reject an Invalid Date before it reaches a comparison.
 *
 * Every comparison against `NaN` is `false`, so an unvalidated Invalid Date does
 * not fail here — it answers "not within" and "does not overlap". For the two
 * documented consumers of {@link rangesOverlap} (order booking collision, flow
 * reservation-window collision) "does not overlap" is the PERMISSIVE answer: a
 * corrupt range silently double-books instead of erroring. A range you cannot
 * interpret must fail, not widen.
 */
function assertUsableRange(range: DateRange, label: string): void {
  const start = range.start?.getTime?.();
  const end = range.end?.getTime?.();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new DateRangeError(
      `${label} has a non-finite endpoint (start=${String(range.start)}, end=${String(range.end)}) — ` +
        'an Invalid Date compares false against everything, which would silently report "no overlap".',
    );
  }
}

export function isDateRange(value: unknown): value is DateRange {
  if (typeof value !== 'object' || value === null) return false;
  const { start, end } = value as DateRange;
  return (
    start instanceof Date &&
    end instanceof Date &&
    Number.isFinite(start.getTime()) &&
    Number.isFinite(end.getTime())
  );
}

/**
 * True if `d` is inclusively within `range`.
 *
 * @throws DateRangeError if `d` or either endpoint is an Invalid Date.
 */
export function isWithin(d: Date, range: DateRange): boolean {
  const t = d?.getTime?.();
  if (!Number.isFinite(t)) {
    throw new DateRangeError(`isWithin received a non-finite instant: ${String(d)}`);
  }
  assertUsableRange(range, 'range');
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/**
 * Range duration in milliseconds.
 *
 * @throws DateRangeError if either endpoint is an Invalid Date (which would
 *   otherwise return `NaN` and propagate silently into a duration total).
 */
export function rangeDurationMs(range: DateRange): number {
  assertUsableRange(range, 'range');
  return range.end.getTime() - range.start.getTime();
}

/**
 * True if two half-open ranges `[start, end)` overlap.
 *
 * Note: the `DateRange` shape documents its endpoints as closed, but
 * overlap-detection queries almost always want half-open semantics so two
 * adjacent slots (10-11, 11-12) don't register as a conflict. Consumers
 * needing fully-closed semantics can still use `isWithin` against each
 * endpoint.
 *
 * Used by:
 *   - `@classytic/order` booking overlap detection
 *   - `@classytic/flow` reservation window collision
 *   - promo / offer campaign window overlap checks
 *
 * @throws DateRangeError if either range carries an Invalid Date. For all three
 *   consumers above, `false` is the PERMISSIVE answer — "no conflict, go ahead
 *   and book" — so a range we cannot read must not be allowed to produce it.
 */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  assertUsableRange(a, 'range a');
  assertUsableRange(b, 'range b');
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

// ─────────────────────────────────────────────────────────────────────────
// Timezone-aware resolution — Period → DateRange
// ─────────────────────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

function assertZone(timezone: unknown): string {
  if (typeof timezone !== 'string' || timezone.length === 0) {
    throw new PeriodError(
      'MISSING_TIMEZONE',
      `A business period needs an IANA timezone (e.g. 'Asia/Dhaka'); received ${String(timezone)}. ` +
        "Resolving without one would silently answer in UTC, which is a different month at both ends for every deployment that isn't on UTC.",
    );
  }
  if (!isValidTimeZone(timezone)) {
    throw new PeriodError(
      'MISSING_TIMEZONE',
      `Unknown IANA timezone '${timezone}'. A misread zone resolves to a plausible but different calendar.`,
    );
  }
  return timezone;
}

function assertYear(year: unknown): number {
  if (!Number.isInteger(year) || (year as number) < 1 || (year as number) > 9999) {
    throw new PeriodError(
      'INVALID_FIELD',
      `year must be an integer in [1, 9999], got ${String(year)}`,
    );
  }
  return year as number;
}

function assertMonth(month: unknown): number {
  if (!Number.isInteger(month) || (month as number) < 1 || (month as number) > 12) {
    throw new PeriodError(
      'INVALID_FIELD',
      `month must be an integer in [1, 12], got ${String(month)}`,
    );
  }
  return month as number;
}

function assertQuarter(quarter: unknown): 1 | 2 | 3 | 4 {
  if (!Number.isInteger(quarter) || (quarter as number) < 1 || (quarter as number) > 4) {
    throw new PeriodError(
      'INVALID_FIELD',
      `quarter must be an integer in [1, 4], got ${String(quarter)}`,
    );
  }
  return quarter as 1 | 2 | 3 | 4;
}

/**
 * The first instant of a local calendar day, in `timezone`. DST-exact — the
 * civil-date round-trip resolves the offset AT local midnight, not at "now".
 */
export function dayStart(date: CivilDate | string, timezone: string): Date {
  return civilDateToInstant(civilDate(date), assertZone(timezone));
}

/** Half-open `[start, end)` range covering one local calendar day. */
export function resolveDay(date: CivilDate | string, timezone: string): DateRange {
  const zone = assertZone(timezone);
  const cd = civilDate(date);
  return { start: dayStart(cd, zone), end: dayStart(addCivilDays(cd, 1), zone) };
}

/**
 * Half-open `[start, end)` range covering one local calendar month.
 * `resolveMonth(2026, 8, 'Asia/Dhaka')` →
 * `[2026-07-31T18:00Z, 2026-08-31T18:00Z)` — the DHAKA month, six hours off
 * the UTC one at both ends.
 */
export function resolveMonth(year: number, month: number, timezone: string): DateRange {
  const zone = assertZone(timezone);
  const y = assertYear(year);
  const m = assertMonth(month);
  const start = dayStart(`${y}-${pad2(m)}-01`, zone);
  const end =
    m === 12 ? dayStart(`${y + 1}-01-01`, zone) : dayStart(`${y}-${pad2(m + 1)}-01`, zone);
  return { start, end };
}

/** Half-open `[start, end)` range covering one local calendar quarter. */
export function resolveQuarter(year: number, quarter: 1 | 2 | 3 | 4, timezone: string): DateRange {
  const zone = assertZone(timezone);
  const y = assertYear(year);
  const q = assertQuarter(quarter);
  const firstMonth = (q - 1) * 3 + 1;
  return {
    start: resolveMonth(y, firstMonth, zone).start,
    end: resolveMonth(y, firstMonth + 2, zone).end,
  };
}

/** Half-open `[start, end)` range covering one local calendar year. */
export function resolveYear(year: number, timezone: string): DateRange {
  const zone = assertZone(timezone);
  const y = assertYear(year);
  return { start: dayStart(`${y}-01-01`, zone), end: dayStart(`${y + 1}-01-01`, zone) };
}

/**
 * Half-open range spanning two local dates, INCLUSIVE of both days — what an
 * operator means by "1st to 31st". The half-open end is therefore the start of
 * the day AFTER `to`.
 */
export function resolveDateSpan(
  from: CivilDate | string,
  to: CivilDate | string,
  timezone: string,
): DateRange {
  const zone = assertZone(timezone);
  const start = dayStart(civilDate(from), zone);
  const end = dayStart(addCivilDays(civilDate(to), 1), zone);
  if (end.getTime() < start.getTime()) {
    throw new PeriodError('INVALID_FIELD', `date span '${from}'..'${to}' ends before it starts`);
  }
  return { start, end };
}

/** Which resolution shape this period carries. Throws when it carries two. */
export function granularityOf(period: Period): PeriodGranularity {
  const hasAdHoc = period.start !== undefined || period.end !== undefined;
  const hasMonth = period.month !== undefined;
  const hasQuarter = period.quarter !== undefined;

  const shapes = [hasAdHoc, hasMonth, hasQuarter].filter(Boolean).length;
  if (shapes > 1) {
    throw new PeriodError(
      'AMBIGUOUS_PERIOD',
      `Period declares more than one resolution shape (month=${String(period.month)}, quarter=${String(
        period.quarter,
      )}, start=${String(period.start)}, end=${String(period.end)}). ` +
        'Two possible answers to "which instants is this?" must not be silently reduced to one — set exactly one of month, quarter, or start+end.',
    );
  }
  if (hasAdHoc) {
    if (period.start === undefined || period.end === undefined) {
      throw new PeriodError(
        'INCOMPLETE_RANGE',
        'An ad-hoc Period needs BOTH start and end; a half-supplied range would resolve as an open-ended one.',
      );
    }
    return 'custom';
  }
  if (hasMonth) return 'month';
  if (hasQuarter) return 'quarter';
  return 'year';
}

/**
 * Resolve the zone a period must be read in.
 *
 * `period.timezone` is the zone the period was DEFINED in; `timezone` is the
 * caller's (usually the deployment default). Supplying both with different
 * values is a bug — one of them is describing a different calendar than the
 * data was computed against — so it throws rather than picking a winner.
 */
export function periodTimeZone(period: Period, timezone?: string): string {
  const own = period.timezone;
  if (own !== undefined && timezone !== undefined && own !== timezone) {
    throw new PeriodError(
      'TIMEZONE_CONFLICT',
      `Period is defined in '${own}' but was asked to resolve in '${timezone}'. ` +
        'These are different calendars; silently choosing one produces a plausible range for the wrong month.',
    );
  }
  return assertZone(own ?? timezone);
}

/**
 * `Period` → half-open `[start, end)` instants, in a business timezone.
 *
 * The single derivation every kernel, module and host should reach for.
 *
 * ```ts
 * resolvePeriod({ year: 2026, month: 8 }, 'Asia/Dhaka');
 * // → [2026-07-31T18:00:00Z, 2026-08-31T18:00:00Z)
 * ```
 *
 * An ad-hoc period (`start` + `end`) needs no zone and is returned verbatim
 * after an Invalid-Date check.
 */
export function resolvePeriod(period: Period, timezone?: string): DateRange {
  const granularity = granularityOf(period);

  if (granularity === 'custom') {
    // Non-null by construction: granularityOf already rejected a half range.
    const range = { start: period.start as Date, end: period.end as Date };
    assertUsableRange(range, 'ad-hoc period');
    return range;
  }

  const zone = periodTimeZone(period, timezone);
  if (granularity === 'month') return resolveMonth(period.year, period.month as number, zone);
  if (granularity === 'quarter')
    return resolveQuarter(period.year, period.quarter as 1 | 2 | 3 | 4, zone);
  return resolveYear(period.year, zone);
}

/**
 * The LAST instant of a half-open range — `end - 1ms`.
 *
 * For the `$lte` call sites that predate half-open ranges. Derived from the
 * resolved end rather than `start + 24h - 1`, so it stays DST-exact.
 */
export function inclusiveEnd(range: DateRange): Date {
  assertUsableRange(range, 'range');
  return new Date(range.end.getTime() - 1);
}

/**
 * The period an INSTANT falls in, on the local calendar.
 *
 * The inverse of {@link resolvePeriod}, and the answer to "which filing month
 * is this posting in?" — asked at local midnight ±6h, `getUTCMonth()` answers a
 * different month. The returned period carries the zone it was derived in, so
 * a later `resolvePeriod` cannot re-read it against a different calendar.
 */
export function periodOf(
  instant: Date,
  granularity: Exclude<PeriodGranularity, 'custom'>,
  timezone: string,
): Period {
  const zone = assertZone(timezone);
  const cd = civilDateOf(instant, zone);
  const year = Number(cd.slice(0, 4));
  const month = Number(cd.slice(5, 7));
  if (granularity === 'year') return { year, timezone: zone };
  if (granularity === 'quarter') {
    return { year, quarter: (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4, timezone: zone };
  }
  return { year, month, timezone: zone };
}

const YEAR_RE = /^(\d{4})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a period LABEL — `'2026'`, `'2026-08'`, `'2026-Q3'`.
 *
 * Case-sensitive on the `Q` and strictly anchored: a label this cannot read
 * throws instead of degrading to the year it could see. A `'YYYY-MM-DD'` is
 * rejected with a pointer to {@link resolveDay}, because a `Period` has no day
 * field and quietly reading it as its month is a 30× widening of the range.
 */
export function parsePeriod(label: string, timezone?: string): Period {
  const withZone = (p: Period): Period =>
    timezone === undefined ? p : { ...p, timezone: assertZone(timezone) };
  const text = String(label);

  const month = MONTH_RE.exec(text);
  if (month) {
    return withZone({ year: assertYear(Number(month[1])), month: assertMonth(Number(month[2])) });
  }
  const quarter = QUARTER_RE.exec(text);
  if (quarter) {
    return withZone({
      year: assertYear(Number(quarter[1])),
      quarter: assertQuarter(Number(quarter[2])),
    });
  }
  const year = YEAR_RE.exec(text);
  if (year) return withZone({ year: assertYear(Number(year[1])) });

  if (CIVIL_DATE_RE.test(text)) {
    throw new PeriodError(
      'INVALID_LABEL',
      `'${text}' is a civil DATE, not a period label. A Period has no day field, so reading it as its month would widen the range ~30×. Use resolveDay('${text}', timezone).`,
    );
  }
  throw new PeriodError(
    'INVALID_LABEL',
    `Invalid period label '${text}' — expected 'YYYY', 'YYYY-MM' or 'YYYY-Qn'.`,
  );
}

/**
 * `Period` → its canonical label. Round-trips through {@link parsePeriod}.
 * Throws for an ad-hoc period, which has no label — format its endpoints.
 */
export function formatPeriod(period: Period): string {
  const granularity = granularityOf(period);
  const year = assertYear(period.year);
  if (granularity === 'month') return `${year}-${pad2(assertMonth(period.month))}`;
  if (granularity === 'quarter') return `${year}-Q${assertQuarter(period.quarter)}`;
  if (granularity === 'year') return String(year);
  throw new PeriodError('INVALID_LABEL', 'An ad-hoc Period (start + end) has no canonical label.');
}
