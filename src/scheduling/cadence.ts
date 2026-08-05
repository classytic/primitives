/**
 * Recurrence spec + pure date arithmetic.
 *
 * Describes "every N days", "every weekday", "on the 15th of each month", etc.
 * Consumed by `@classytic/order` (blanket / recurring orders, subscription
 * renewal), `@classytic/flow` (replenishment schedules), and
 * `@classytic/commission` (vesting periods, statement close).
 *
 * No cron parser dep — the `cron` kind stores an opaque string that the host
 * parses with its own library (node-cron, croner, etc.). This keeps primitives
 * zero-dep and lets hosts pick whatever cron dialect they want.
 *
 * @example
 * const monthly: Cadence = {
 *   kind: 'monthly',
 *   interval: 1,
 *   dayOfMonth: 15,
 *   startAt: new Date('2026-01-15T00:00:00Z'),
 * };
 * nextOccurrence(monthly, new Date('2026-02-20T00:00:00Z'));
 * // → 2026-03-15T00:00:00Z
 */

import {
  addCivilDays,
  type CivilDate,
  civilDate,
  civilDateOf,
  civilDateToInstant,
  civilDaysBetween,
  isValidTimeZone,
  localTimeParts,
} from './timezone.js';

export type CadenceKind = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'cron';

/** ISO weekday — 1=Mon … 7=Sun. Matches Temporal + ISO 8601. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface CadenceBase {
  readonly interval: number;
  readonly startAt: Date;
  readonly endAt?: Date;
  /**
   * IANA zone the recurrence's WALL CLOCK is anchored to (e.g. `Asia/Dhaka`).
   * **Authoritative, not decorative.**
   *
   * When set, occurrence math runs on that zone's calendar: `dayOfMonth: 1`
   * lands on local midnight-relative wall time of the local 1st, weekday
   * filters read the local weekday, and daily steps advance local calendar
   * days (23h or 25h across a DST transition, not a flat 24h).
   *
   * When ABSENT, everything is UTC — the right default for a schedule that
   * genuinely has no locale.
   *
   * History worth keeping: this field used to be documented as display-only
   * while `stepMonthly` / `stepYearly` read `getUTCMonth()` / `getUTCDate()`.
   * With `timezone: 'Asia/Dhaka'` and `dayOfMonth: 1` that placed every
   * occurrence on the UTC 1st — 06:00 on the local 1st, or with a midnight
   * anchor, the local **2nd at 00:00**. The field said one thing and the math
   * did another, and nothing failed. A field that lies is worse than no field.
   */
  readonly timezone?: string;
}

export interface DailyCadence extends CadenceBase {
  readonly kind: 'daily';
}

export interface WeeklyCadence extends CadenceBase {
  readonly kind: 'weekly';
  /**
   * If provided, only these ISO weekdays count as occurrences; the earliest
   * matching weekday on or after `startAt` is the first occurrence. If omitted,
   * the weekday of `startAt` is used.
   */
  readonly daysOfWeek?: readonly IsoWeekday[];
}

export interface MonthlyCadence extends CadenceBase {
  readonly kind: 'monthly';
  /**
   * Day of month, 1–31. If the target month has fewer days (e.g. 31st → Feb),
   * occurrence snaps to the last day of the month.
   */
  readonly dayOfMonth: number;
}

export interface YearlyCadence extends CadenceBase {
  readonly kind: 'yearly';
  /** Calendar month 1–12. */
  readonly month: number;
  /** Day of month 1–31. Snaps to last day of month if needed (e.g. Feb 29 → Feb 28 in non-leap years). */
  readonly dayOfMonth: number;
}

export interface CronCadence extends CadenceBase {
  readonly kind: 'cron';
  /** Opaque cron expression — caller parses with its own cron library. */
  readonly expression: string;
}

export type Cadence = DailyCadence | WeeklyCadence | MonthlyCadence | YearlyCadence | CronCadence;

export type CadenceErrorCode =
  | 'INVALID_INTERVAL'
  | 'INVALID_DAY_OF_MONTH'
  | 'INVALID_MONTH'
  | 'INVALID_DAYS_OF_WEEK'
  | 'INVALID_START_AT'
  | 'INVALID_END_AT'
  | 'INVALID_TIMEZONE'
  | 'UNSUPPORTED_CRON';

export class CadenceError extends Error {
  override readonly name = 'CadenceError';
  readonly code: CadenceErrorCode;

  constructor(code: CadenceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Validate a Cadence spec. Call this before storing host-side. */
export function validateCadence(c: Cadence): void {
  if (!Number.isInteger(c.interval) || c.interval < 1) {
    throw new CadenceError(
      'INVALID_INTERVAL',
      `interval must be a positive integer, got ${c.interval}`,
    );
  }
  if (Number.isNaN(c.startAt.getTime())) {
    throw new CadenceError('INVALID_START_AT', 'startAt is not a valid Date');
  }
  if (c.endAt && Number.isNaN(c.endAt.getTime())) {
    throw new CadenceError('INVALID_END_AT', 'endAt is not a valid Date');
  }
  if (c.endAt && c.endAt.getTime() < c.startAt.getTime()) {
    throw new CadenceError('INVALID_END_AT', 'endAt must be >= startAt');
  }
  // The zone drives the arithmetic, so a name this runtime cannot resolve must
  // fail HERE — at validation, before storage. Falling back to UTC would place
  // every occurrence on a different calendar than the operator configured, and
  // the schedule would still look correct in the document.
  if (c.timezone !== undefined && !isValidTimeZone(c.timezone)) {
    throw new CadenceError(
      'INVALID_TIMEZONE',
      `timezone must be a valid IANA zone name (e.g. 'Asia/Dhaka'), got '${c.timezone}'`,
    );
  }

  if (c.kind === 'weekly' && c.daysOfWeek) {
    if (c.daysOfWeek.length === 0) {
      throw new CadenceError('INVALID_DAYS_OF_WEEK', 'daysOfWeek cannot be empty');
    }
    for (const d of c.daysOfWeek) {
      if (!Number.isInteger(d) || d < 1 || d > 7) {
        throw new CadenceError('INVALID_DAYS_OF_WEEK', `daysOfWeek entry must be 1–7, got ${d}`);
      }
    }
  }
  if (c.kind === 'monthly') {
    assertValidDayOfMonth(c.dayOfMonth);
  }
  if (c.kind === 'yearly') {
    if (!Number.isInteger(c.month) || c.month < 1 || c.month > 12) {
      throw new CadenceError('INVALID_MONTH', `month must be 1–12, got ${c.month}`);
    }
    assertValidDayOfMonth(c.dayOfMonth);
  }
}

function assertValidDayOfMonth(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new CadenceError('INVALID_DAY_OF_MONTH', `dayOfMonth must be 1–31, got ${day}`);
  }
}

/**
 * Next occurrence strictly after `from`. Returns `null` if the cadence has
 * ended (endAt passed) or the first occurrence is still in the future.
 *
 * Cron cadences return `null` — hosts must parse the expression themselves.
 */
export function nextOccurrence(cadence: Cadence, from: Date): Date | null {
  validateCadence(cadence);

  if (cadence.kind === 'cron') {
    return null;
  }

  const fromMs = from.getTime();
  if (cadence.endAt && fromMs >= cadence.endAt.getTime()) {
    return null;
  }

  // If `from` is before the first occurrence, return the first occurrence.
  const first = cadence.startAt;
  if (fromMs < first.getTime()) {
    return first;
  }

  const next = stepForward(cadence, from);
  if (next === null) return null;
  if (cadence.endAt && next.getTime() > cadence.endAt.getTime()) return null;
  return next;
}

/**
 * Enumerate occurrences in `[from, to)` inclusive at `from`, exclusive at `to`.
 * Returns up to `limit` results (default 10_000) to guard against runaway
 * misconfigured cadences. Cron returns an empty array.
 */
export function occurrencesBetween(cadence: Cadence, from: Date, to: Date, limit = 10_000): Date[] {
  validateCadence(cadence);
  if (cadence.kind === 'cron') return [];

  const result: Date[] = [];
  let cursor: Date | null =
    cadence.startAt.getTime() >= from.getTime()
      ? cadence.startAt
      : nextOccurrence(cadence, new Date(from.getTime() - 1));

  while (cursor !== null && cursor.getTime() < to.getTime() && result.length < limit) {
    if (cursor.getTime() >= from.getTime()) {
      result.push(cursor);
    }
    cursor = nextOccurrence(cadence, cursor);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Step-forward per kind
//
// Two arithmetics, selected by `cadence.timezone`:
//   - absent  → UTC (unchanged; the right answer for a locale-free schedule)
//   - present → that zone's wall clock, via /timezone's DST-exact civil-date
//               round-trip
//
// Both live behind ONE dispatch so they cannot drift the way a "monthly is
// zone-aware but daily isn't" split would.
// ─────────────────────────────────────────────────────────────────────────

function stepForward(cadence: Cadence, from: Date): Date | null {
  const zone = cadence.timezone;
  switch (cadence.kind) {
    case 'daily':
      return zone === undefined ? stepDaily(cadence, from) : stepDailyZoned(cadence, from, zone);
    case 'weekly':
      return zone === undefined ? stepWeekly(cadence, from) : stepWeeklyZoned(cadence, from, zone);
    case 'monthly':
      return zone === undefined
        ? stepMonthly(cadence, from)
        : stepMonthlyZoned(cadence, from, zone);
    case 'yearly':
      return zone === undefined ? stepYearly(cadence, from) : stepYearlyZoned(cadence, from, zone);
    default:
      return null;
  }
}

// ─── Wall-clock (zoned) arithmetic ──────────────────────────────────────────

interface WallClock {
  readonly year: number;
  /** 1-based. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

/**
 * The anchor's LOCAL wall clock. Seconds and milliseconds come straight from
 * the instant because every modern IANA offset is a whole number of minutes —
 * they are the same in every zone.
 */
function wallClockOf(instant: Date, zone: string): WallClock {
  const cd = civilDateOf(instant, zone);
  const { hour, minute } = localTimeParts(instant, zone);
  return {
    year: Number(cd.slice(0, 4)),
    month: Number(cd.slice(5, 7)),
    day: Number(cd.slice(8, 10)),
    hour,
    minute,
    second: instant.getUTCSeconds(),
    millisecond: instant.getUTCMilliseconds(),
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function civilOf(year: number, month: number, day: number): CivilDate {
  return civilDate(`${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`);
}

/** Bind a local calendar day + the anchor's local time-of-day to an instant. */
function bindWall(cd: CivilDate, wall: WallClock, zone: string): Date {
  return civilDateToInstant(cd, zone, {
    hour: wall.hour,
    minute: wall.minute,
    second: wall.second,
    millisecond: wall.millisecond,
  });
}

/** Occurrences are anchor-local-date + n×interval LOCAL days, at the anchor's local time. */
function stepDailyZoned(c: DailyCadence, from: Date, zone: string): Date {
  const wall = wallClockOf(c.startAt, zone);
  const anchorCd = civilOf(wall.year, wall.month, wall.day);
  const elapsed = civilDaysBetween(anchorCd, civilDateOf(from, zone));
  let n = Math.max(0, Math.floor(elapsed / c.interval) * c.interval);
  // Converges in at most a couple of iterations; the cap only bounds a
  // pathological input rather than letting it spin.
  for (let i = 0; i < 1000; i++) {
    const candidate = bindWall(addCivilDays(anchorCd, n), wall, zone);
    if (candidate.getTime() > from.getTime()) return candidate;
    n += c.interval;
  }
  return bindWall(addCivilDays(anchorCd, n), wall, zone);
}

/** ISO weekday of a civil date — zone-free, a calendar day has a determinate weekday. */
function isoWeekdayOfCivil(cd: CivilDate): IsoWeekday {
  const utc = Date.UTC(Number(cd.slice(0, 4)), Number(cd.slice(5, 7)) - 1, Number(cd.slice(8, 10)));
  return (((new Date(utc).getUTCDay() + 6) % 7) + 1) as IsoWeekday;
}

function stepWeeklyZoned(c: WeeklyCadence, from: Date, zone: string): Date {
  const wall = wallClockOf(c.startAt, zone);
  const anchorCd = civilOf(wall.year, wall.month, wall.day);
  const targetDays = c.daysOfWeek ?? [isoWeekdayOfCivil(anchorCd)];

  let cursor = civilDateOf(from, zone);
  const maxSteps = Math.max(60, c.interval * 14) + 2;
  for (let i = 0; i < maxSteps; i++) {
    if (targetDays.includes(isoWeekdayOfCivil(cursor))) {
      const weeksSinceAnchor = Math.floor(civilDaysBetween(anchorCd, cursor) / 7);
      if (weeksSinceAnchor >= 0 && weeksSinceAnchor % c.interval === 0) {
        const candidate = bindWall(cursor, wall, zone);
        if (candidate.getTime() > from.getTime()) return candidate;
      }
    }
    cursor = addCivilDays(cursor, 1);
  }
  return bindWall(cursor, wall, zone);
}

function stepMonthlyZoned(c: MonthlyCadence, from: Date, zone: string): Date {
  const wall = wallClockOf(c.startAt, zone);
  let candYear = wall.year;
  let candMonth = wall.month; // 1-based

  // Jump straight to the last interval-aligned month at or before `from`'s LOCAL
  // month, then walk. Walking from the anchor one interval at a time would make
  // each call O(months since anchor) with two ICU offset lookups per step — fine
  // for next month, a stall for a decade-old anchor. `floor` never overshoots, so
  // the walk below still decides the answer.
  const fromCd = civilDateOf(from, zone);
  const monthsDiff =
    (Number(fromCd.slice(0, 4)) - wall.year) * 12 + (Number(fromCd.slice(5, 7)) - wall.month);
  if (monthsDiff > 0) {
    const aligned = Math.floor(monthsDiff / c.interval) * c.interval;
    const abs = candYear * 12 + (candMonth - 1) + aligned;
    candYear = Math.floor(abs / 12);
    candMonth = (abs % 12) + 1;
  }

  for (let i = 0; i < 1000; i++) {
    const day = clampDayOfMonth(c.dayOfMonth, candYear, candMonth - 1);
    const candidate = bindWall(civilOf(candYear, candMonth, day), wall, zone);
    if (candidate.getTime() > from.getTime()) return candidate;
    candMonth += c.interval;
    while (candMonth > 12) {
      candMonth -= 12;
      candYear += 1;
    }
  }
  return bindWall(
    civilOf(candYear, candMonth, clampDayOfMonth(c.dayOfMonth, candYear, candMonth - 1)),
    wall,
    zone,
  );
}

function stepYearlyZoned(c: YearlyCadence, from: Date, zone: string): Date {
  const wall = wallClockOf(c.startAt, zone);
  let candYear = wall.year;

  // Same fast-forward as monthly, and for the same reason.
  const yearsDiff = Number(civilDateOf(from, zone).slice(0, 4)) - wall.year;
  if (yearsDiff > 0) {
    candYear += Math.floor(yearsDiff / c.interval) * c.interval;
  }

  for (let i = 0; i < 1000; i++) {
    const day = clampDayOfMonth(c.dayOfMonth, candYear, c.month - 1);
    const candidate = bindWall(civilOf(candYear, c.month, day), wall, zone);
    if (candidate.getTime() > from.getTime()) return candidate;
    candYear += c.interval;
  }
  return bindWall(
    civilOf(candYear, c.month, clampDayOfMonth(c.dayOfMonth, candYear, c.month - 1)),
    wall,
    zone,
  );
}

// ─── UTC arithmetic (no zone configured) ────────────────────────────────────

function stepDaily(c: DailyCadence, from: Date): Date {
  const start = c.startAt;
  const diffDays = Math.floor((from.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const nextNthDay = Math.floor(diffDays / c.interval) * c.interval + c.interval;
  const nextMs = start.getTime() + nextNthDay * 24 * 60 * 60 * 1000;
  return new Date(nextMs);
}

function stepWeekly(c: WeeklyCadence, from: Date): Date {
  const anchor = c.startAt;
  const targetDays = c.daysOfWeek ?? [isoWeekday(anchor)];
  const sortedDays = [...targetDays].sort((a, b) => a - b);

  // Find the earliest target weekday strictly after `from` that lies on an
  // interval-aligned week relative to `anchor`.
  // We iterate day-by-day; week cadence is rare enough that O(~7*interval) is fine.
  const oneDay = 24 * 60 * 60 * 1000;
  const msPerWeek = 7 * oneDay;

  let cursor = from.getTime() + oneDay; // strictly after `from`
  // Safety cap — no more than interval*14 days to find the next one.
  const maxSteps = Math.max(60, c.interval * 14);
  for (let i = 0; i < maxSteps; i++) {
    const d = new Date(cursor);
    // Match weekday filter.
    if (!sortedDays.includes(isoWeekday(d))) {
      cursor += oneDay;
      continue;
    }
    // Check interval alignment — weeks-since-anchor must be divisible by interval.
    const diffWeeks = Math.floor((d.getTime() - anchor.getTime()) / msPerWeek);
    if (diffWeeks % c.interval === 0 && d.getTime() >= anchor.getTime()) {
      // Preserve time-of-day from anchor.
      return withTime(d, anchor);
    }
    cursor += oneDay;
  }
  // Shouldn't happen with valid inputs.
  return new Date(cursor);
}

function stepMonthly(c: MonthlyCadence, from: Date): Date {
  const anchor = c.startAt;
  // Compute candidate month: at least next month after `from`.
  const year = from.getUTCFullYear();
  const monthIdx = from.getUTCMonth(); // 0..11
  // Move to the next interval-aligned month after `from`.
  // Align to anchor by stepping interval months at a time until > from.
  // Start from anchor's month/year, step until > from.
  let candYear = anchor.getUTCFullYear();
  let candMonth = anchor.getUTCMonth();
  while (true) {
    const dayClamped = clampDayOfMonth(c.dayOfMonth, candYear, candMonth);
    const candidate = new Date(
      Date.UTC(
        candYear,
        candMonth,
        dayClamped,
        anchor.getUTCHours(),
        anchor.getUTCMinutes(),
        anchor.getUTCSeconds(),
        anchor.getUTCMilliseconds(),
      ),
    );
    if (candidate.getTime() > from.getTime()) {
      return candidate;
    }
    candMonth += c.interval;
    while (candMonth > 11) {
      candMonth -= 12;
      candYear += 1;
    }
    // guard against runaway
    if (candYear - year > 10_000) {
      return candidate;
    }
  }
  // Unreachable — loop returns first.
  // eslint-disable-next-line no-unreachable
  return new Date(Date.UTC(year, monthIdx, 1));
}

function stepYearly(c: YearlyCadence, from: Date): Date {
  const anchor = c.startAt;
  const anchorYear = anchor.getUTCFullYear();
  // Same strategy: step yearly from anchor until > from.
  let candYear = anchorYear;
  while (true) {
    const dayClamped = clampDayOfMonth(c.dayOfMonth, candYear, c.month - 1);
    const candidate = new Date(
      Date.UTC(
        candYear,
        c.month - 1,
        dayClamped,
        anchor.getUTCHours(),
        anchor.getUTCMinutes(),
        anchor.getUTCSeconds(),
        anchor.getUTCMilliseconds(),
      ),
    );
    if (candidate.getTime() > from.getTime()) {
      return candidate;
    }
    candYear += c.interval;
    if (candYear - anchorYear > 10_000) {
      return candidate;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function isoWeekday(d: Date): IsoWeekday {
  // Date#getUTCDay → 0 (Sun) .. 6 (Sat); map to ISO 1 (Mon) .. 7 (Sun).
  const js = d.getUTCDay();
  return (((js + 6) % 7) + 1) as IsoWeekday;
}

function withTime(d: Date, timeSource: Date): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      timeSource.getUTCHours(),
      timeSource.getUTCMinutes(),
      timeSource.getUTCSeconds(),
      timeSource.getUTCMilliseconds(),
    ),
  );
}

function clampDayOfMonth(day: number, year: number, monthIdx: number): number {
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  return Math.min(day, lastDay);
}
