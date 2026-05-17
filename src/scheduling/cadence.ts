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

export type CadenceKind = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'cron';

/** ISO weekday — 1=Mon … 7=Sun. Matches Temporal + ISO 8601. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface CadenceBase {
  readonly interval: number;
  readonly startAt: Date;
  readonly endAt?: Date;
  /**
   * Optional timezone IANA name (e.g. `Asia/Dhaka`). Pure functions in this
   * module operate on UTC Date values; the field is carried for the host to
   * localize occurrences when displaying. Occurrence math here is UTC-based.
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
// Step-forward per kind (pure UTC arithmetic)
// ─────────────────────────────────────────────────────────────────────────

function stepForward(cadence: Cadence, from: Date): Date | null {
  switch (cadence.kind) {
    case 'daily':
      return stepDaily(cadence, from);
    case 'weekly':
      return stepWeekly(cadence, from);
    case 'monthly':
      return stepMonthly(cadence, from);
    case 'yearly':
      return stepYearly(cadence, from);
    default:
      return null;
  }
}

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
