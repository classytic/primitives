/**
 * IANA timezone resolution + civil dates — the "door" for `/calendar`'s
 * escape hatch.
 *
 * The scheduling stack splits time into three types (Temporal's model):
 *
 *   - **Instant** — a point on the global timeline. `Date` (UTC epoch).
 *     Stored, compared, transported. Never localized in storage.
 *   - **Wall clock** — an instant viewed through an IANA zone (pricing
 *     windows, slot grids, "peak 17:00–22:00"). Resolved HERE, at the edge.
 *   - **Civil date** — a calendar day with no time and no zone until one is
 *     bound (hotel night, POS business date, VAT filing year). `CivilDate`.
 *
 * Division of labour — NOT redundancy with `/calendar`:
 *
 *   - `/calendar` owns wall-clock **arithmetic** over a fixed
 *     `UtcOffsetMinutes` (startOfDay, addMonths, …). It deliberately knows
 *     no IANA names and no DST.
 *   - `/timezone` owns **resolution**: IANA zone + instant → offset / wall
 *     parts / civil date. It does NO arithmetic.
 *   - They compose: `startOfDay(instant, zoneOffsetMinutes(instant, zone))`.
 *     For a DST-exact day boundary use the civil-date round-trip instead:
 *     `civilDateToInstant(civilDateOf(instant, zone), zone)` — correct even
 *     when the offset at local midnight differs from the offset at `instant`.
 *
 * Zero-dependency by construction: `Intl.DateTimeFormat` IS the ICU timezone
 * database shipped with every supported runtime (Node >= 18, evergreen
 * browsers) — no tz-data package, nothing to keep updated. When Temporal
 * lands on our engine floor, these map 1:1 (`zoneOffsetMinutes` →
 * `ZonedDateTime.offset`, `CivilDate` → `PlainDate`) and migration is
 * mechanical.
 *
 * Formatter instances are cached per zone — construction is the expensive
 * part of Intl, and the zone universe is bounded (~600 IANA names).
 */

import type { Brand } from '../composition/brand.js';
import type { IsoWeekday } from './cadence.js';
import type { UtcOffsetMinutes } from './calendar.js';
import type { DateRange } from './period.js';

const MINUTE_MS = 60_000;

export class TimeZoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeZoneError';
  }
}

// ─── Formatter caches (per zone, bounded by the IANA universe) ──────────────

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatters = new Map<string, Intl.DateTimeFormat>();
const civilFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = offsetFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      // 'longOffset' emits "GMT+06:00" / "GMT-05:30" / "GMT" — machine-parseable,
      // per-instant (DST-aware), locale-stable under 'en-US'.
      timeZoneName: 'longOffset',
    });
    offsetFormatters.set(zone, fmt);
  }
  return fmt;
}

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = partsFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    partsFormatters.set(zone, fmt);
  }
  return fmt;
}

function civilFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = civilFormatters.get(zone);
  if (!fmt) {
    // 'en-CA' formats as YYYY-MM-DD ordering; we read parts, not the joined
    // string, so the locale only needs stable numeric parts.
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    civilFormatters.set(zone, fmt);
  }
  return fmt;
}

// ─── Zone validation + enumeration ──────────────────────────────────────────

/**
 * Is `zone` a valid IANA timezone name on this runtime's ICU data?
 * Use at BOOT to validate host config (an offer's `timezone`, an org
 * setting) — fail loud at wiring time, not on the first localized read.
 */
export function isValidTimeZone(zone: string): boolean {
  if (typeof zone !== 'string' || zone.length === 0) return false;
  try {
    offsetFormatter(zone);
    return true;
  } catch {
    offsetFormatters.delete(zone);
    return false;
  }
}

let cachedZones: readonly string[] | undefined;

/**
 * Every IANA timezone name this runtime supports — the data source for a
 * Google-Calendar-style zone picker. Straight from ICU via
 * `Intl.supportedValuesOf` (Node >= 18); no bundled tz list to go stale.
 *
 * UIs typically label each entry with its current offset:
 * `listTimeZones().map((z) => ({ zone: z, label: zoneOffsetLabel(now, z) }))`.
 */
export function listTimeZones(): readonly string[] {
  if (cachedZones) return cachedZones;
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  if (typeof intl.supportedValuesOf !== 'function') {
    throw new TimeZoneError(
      'Intl.supportedValuesOf is unavailable on this runtime (requires Node >= 18 / ' +
        'a modern browser). Upgrade the runtime or supply a static zone list.',
    );
  }
  cachedZones = Object.freeze(intl.supportedValuesOf('timeZone'));
  return cachedZones;
}

// ─── Offset resolution (the /calendar bridge) ───────────────────────────────

/**
 * ANCHORED on purpose.
 *
 * The unanchored form (`/GMT(?:([+-])(\d{2}):(\d{2}))?/`) made the offset group
 * OPTIONAL *and* skippable: any label the runtime emits that this pattern cannot
 * fully parse — `'GMT+5:30'` from an ICU build that does not zero-pad, or a
 * locale that prefixes text — still matched the bare `GMT` alternative and
 * resolved to offset **0**. A half-read offset became "UTC" with no error, which
 * silently shifts every business-day boundary derived from it. Anchoring makes an
 * unrecognised label throw instead; `\d{1,2}` accepts the unpadded variant rather
 * than mis-reading it.
 */
const OFFSET_RE = /^GMT(?:([+-])(\d{1,2}):(\d{2}))?$/;

/**
 * The zone's UTC offset AT `instant`, in minutes east of UTC — DST-exact.
 * `zoneOffsetMinutes(july, 'Europe/London')` → 60; `(january, …)` → 0;
 * `(any, 'Asia/Dhaka')` → 360.
 *
 * This is the value `/calendar`'s docstring tells hosts to "resolve and pass
 * in": `startOfMonth(instant, zoneOffsetMinutes(instant, zone))`.
 */
export function zoneOffsetMinutes(instant: Date, zone: string): UtcOffsetMinutes {
  const label = zoneOffsetLabel(instant, zone);
  const m = OFFSET_RE.exec(label);
  if (!m) {
    throw new TimeZoneError(`Unparseable offset '${label}' for zone '${zone}'.`);
  }
  if (m[1] === undefined) return 0; // plain "GMT" — UTC
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * The zone's offset label AT `instant` — `'GMT+06:00'` / `'GMT-05:30'` /
 * `'GMT'`. Ready-made display text for zone pickers.
 */
export function zoneOffsetLabel(instant: Date, zone: string): string {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = offsetFormatter(zone);
  } catch {
    offsetFormatters.delete(zone);
    throw new TimeZoneError(`Invalid IANA timezone: '${zone}'.`);
  }
  const part = fmt.formatToParts(instant).find((p) => p.type === 'timeZoneName');
  if (!part) {
    throw new TimeZoneError(`Runtime produced no offset part for zone '${zone}'.`);
  }
  return part.value;
}

// ─── Wall-clock parts ────────────────────────────────────────────────────────

export interface LocalTimeParts {
  /** ISO weekday in the zone — 1=Mon … 7=Sun (matches `/cadence`). */
  isoWeekday: IsoWeekday;
  /** Hour of day in the zone, 0–23. */
  hour: number;
  /** Minute of hour, 0–59. */
  minute: number;
  /** `hour * 60 + minute` — the shape "HH:MM window" checks want. */
  minutesOfDay: number;
}

const WEEKDAY_TO_ISO: Record<string, IsoWeekday> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * The wall-clock weekday + time of `instant` in `zone` — what pricing
 * schedules ("peak Fri 17:00–22:00"), slot grids, and working-hours checks
 * evaluate against. DST-exact per instant.
 */
export function localTimeParts(instant: Date, zone: string): LocalTimeParts {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = partsFormatter(zone);
  } catch {
    partsFormatters.delete(zone);
    throw new TimeZoneError(`Invalid IANA timezone: '${zone}'.`);
  }
  let weekday: string | undefined;
  let hour: number | undefined;
  let minute: number | undefined;
  for (const part of fmt.formatToParts(instant)) {
    if (part.type === 'weekday') weekday = part.value;
    else if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
  }
  const isoWeekday = weekday !== undefined ? WEEKDAY_TO_ISO[weekday] : undefined;
  if (isoWeekday === undefined || hour === undefined || minute === undefined) {
    throw new TimeZoneError(`Runtime produced incomplete wall parts for zone '${zone}'.`);
  }
  // Some ICU builds emit '24' for midnight with hour12:false — normalize.
  const h = hour === 24 ? 0 : hour;
  return { isoWeekday, hour: h, minute, minutesOfDay: h * 60 + minute };
}

// ─── Civil dates ─────────────────────────────────────────────────────────────

/**
 * A calendar day — `'YYYY-MM-DD'` — with NO time and NO zone until one is
 * bound. The type for hotel nights, POS business dates, statement periods,
 * VAT filing years. Lexicographic order == chronological order, so it's
 * index- and range-query-friendly as a Mongo string key.
 */
export type CivilDate = Brand<string, 'CivilDate'>;

const CIVIL_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Epoch ms of a proleptic-Gregorian UTC date-time. `setUTCFullYear`, not
 * `Date.UTC`: `Date.UTC` maps years 0-99 to 1900-1999. Out-of-range parts
 * overflow as `Date.UTC` does (day 32 is the 1st of the next month).
 */
function utcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, ms);
  return d.getTime();
}

/** Runtime guard for external input. */
export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== 'string') return false;
  const m = CIVIL_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0-99 to 1900-1999,
  // which made ISO leap day 0000-02-29 invalid.
  const last = new Date(0);
  last.setUTCFullYear(y, mo, 0);
  return d <= last.getUTCDate();
}

/** Validate + brand a `'YYYY-MM-DD'` string. Throws on malformed input. */
export function civilDate(value: string): CivilDate {
  if (!isCivilDate(value)) {
    throw new TimeZoneError(`Invalid civil date '${value}' — expected 'YYYY-MM-DD'.`);
  }
  return value;
}

/**
 * The calendar day `instant` falls on IN `zone` — e.g. the POS business
 * date: `civilDateOf(new Date(), 'Asia/Dhaka')`. Never depends on the
 * server's TZ env.
 */
export function civilDateOf(instant: Date, zone: string): CivilDate {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = civilFormatter(zone);
  } catch {
    civilFormatters.delete(zone);
    throw new TimeZoneError(`Invalid IANA timezone: '${zone}'.`);
  }
  let y = '';
  let m = '';
  let d = '';
  for (const part of fmt.formatToParts(instant)) {
    if (part.type === 'year') y = part.value;
    else if (part.type === 'month') m = part.value;
    else if (part.type === 'day') d = part.value;
  }
  return civilDate(`${y.padStart(4, '0')}-${m}-${d}`);
}

/**
 * Bind a civil date (+ optional wall time) to a zone → the exact instant.
 * `civilDateToInstant(night, hotelZone, { hour: 14 })` = check-in instant;
 * with no `time`, local midnight — the DST-exact "start of that day in that
 * zone".
 *
 * Two-pass offset resolution: the offset is looked up AT the candidate
 * instant, then re-checked, so days where a DST transition sits between the
 * wall time and the first guess still resolve correctly. Honest limit: a
 * wall time that does not exist (inside a spring-forward gap) is not
 * normalised consistently — east of UTC it lands after the gap (Berlin
 * 02:30 -> 03:30 CEST), west of UTC before it (New York 02:30 -> 01:30
 * EST) — and an ambiguous fall-back time may pick either occurrence. For a
 * wall time that must follow Temporal's `disambiguation: 'compatible'`
 * (earlier repeated occurrence, forward across a gap), use {@link wallInstant}.
 */
export function civilDateToInstant(
  cd: CivilDate,
  zone: string,
  time: { hour?: number; minute?: number; second?: number; millisecond?: number } = {},
): Date {
  const m = CIVIL_RE.exec(cd);
  if (!m) throw new TimeZoneError(`Invalid civil date '${cd}'.`);
  const hour = time.hour ?? 0;
  const minute = time.minute ?? 0;
  // Seconds and milliseconds are offset-invariant for every zone in modern ICU
  // data (offsets are whole minutes), so they pass straight through. They are
  // accepted because a recurrence anchored at 09:30:15 must reproduce :15 —
  // truncating to the minute silently drifts every occurrence.
  const second = time.second ?? 0;
  const millisecond = time.millisecond ?? 0;
  const wallAsUtc = utcMs(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    hour,
    minute,
    second,
    millisecond,
  );

  const firstOffset = zoneOffsetMinutes(new Date(wallAsUtc), zone);
  let instantMs = wallAsUtc - firstOffset * MINUTE_MS;
  const refined = zoneOffsetMinutes(new Date(instantMs), zone);
  if (refined !== firstOffset) instantMs = wallAsUtc - refined * MINUTE_MS;
  return new Date(instantMs);
}

/**
 * Pure calendar-day arithmetic — `addCivilDays('2026-02-28', 1)` →
 * `'2026-03-01'`. Zone-free by definition (a civil date has no zone);
 * use it to iterate hotel nights / statement days.
 */
export function addCivilDays(cd: CivilDate, days: number): CivilDate {
  const m = CIVIL_RE.exec(cd);
  if (!m) throw new TimeZoneError(`Invalid civil date '${cd}'.`);
  const d = new Date(utcMs(Number(m[1]), Number(m[2]), Number(m[3]) + days));
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return civilDate(`${y}-${mo}-${day}`);
}

/**
 * The ISO-8601 week a civil date belongs to, as `YYYY-Www`.
 *
 * Zone-free by definition — a civil date has no zone — so callers resolve the
 * date in their business timezone FIRST (`civilDateOf`) and label it here.
 *
 * ISO week 1 is the week containing the first Thursday, which means the week
 * YEAR can differ from the date's own: 2025-12-29 is `2026-W01`. Naive
 * "day-of-year / 7" numbering gets that wrong every few years, silently
 * splitting one business week across two report buckets.
 */
export function isoWeekOfCivilDate(cd: CivilDate): string {
  const m = CIVIL_RE.exec(cd);
  if (!m) throw new TimeZoneError(`Invalid civil date '${cd}'.`);
  const utc = utcMs(Number(m[1]), Number(m[2]), Number(m[3]));
  const dow = new Date(utc).getUTCDay() || 7; // Sunday 0 -> ISO 7
  // The Thursday of this ISO week decides the week-year.
  const thursday = new Date(utc + (4 - dow) * 86_400_000);
  const weekYear = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - utcMs(weekYear, 1, 1)) / 86_400_000 / 7) + 1;
  const yearLabel = weekYear >= 0 ? String(weekYear).padStart(4, '0') : String(weekYear);
  return `${yearLabel}-W${String(week).padStart(2, '0')}`;
}

/**
 * Whole days from `a` to `b` (positive when `b` is later) — the NIGHTS
 * count for a `[checkIn, checkOut)` stay expressed as civil dates.
 */
export function civilDaysBetween(a: CivilDate, b: CivilDate): number {
  const pa = CIVIL_RE.exec(a);
  const pb = CIVIL_RE.exec(b);
  if (!pa || !pb) throw new TimeZoneError(`Invalid civil date '${!pa ? a : b}'.`);
  const ma = utcMs(Number(pa[1]), Number(pa[2]), Number(pa[3]));
  const mb = utcMs(Number(pb[1]), Number(pb[2]), Number(pb[3]));
  return Math.round((mb - ma) / 86_400_000);
}

/**
 * Whole calendar months after `cd` (negative goes back). A day past the target
 * month's end clamps to its last day: `addCivilMonths('2026-01-31', 1)` ->
 * `'2026-02-28'` (`'2024-02-29'` in a leap year). Clamping does not carry:
 * `+1` then `+1` from Jan 31 lands on Mar 28, `+2` lands on Mar 31.
 *
 * @throws TimeZoneError on an invalid civil date; RangeError when `months` is
 * not an integer.
 */
export function addCivilMonths(cd: CivilDate, months: number): CivilDate {
  const m = isCivilDate(cd) ? CIVIL_RE.exec(cd) : null;
  if (!m) throw new TimeZoneError(`Invalid civil date '${cd}'.`);
  if (!Number.isInteger(months)) {
    throw new RangeError(`addCivilMonths: months must be an integer, got ${months}.`);
  }
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  if (year < 0 || year > 9999) {
    throw new RangeError(`addCivilMonths: ${cd} + ${months} months leaves years 0000-9999.`);
  }
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0-99 to 1900-1999.
  const lastOfMonth = new Date(0);
  lastOfMonth.setUTCFullYear(year, month, 0);
  const last = lastOfMonth.getUTCDate();
  const day = Math.min(Number(m[3]), last);
  return civilDate(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}

// ─── Wall-clock windows ──────────────────────────────────────────────────────

/**
 * A wall-clock time of day, `'HH:mm'` on the 24-hour clock (`'00:00'` to
 * `'23:59'`). Zone-free until bound to a civil date and a zone.
 */
export type WallTime = string;

const WALL_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Minutes since midnight for an `'HH:mm'` wall time (`'07:30'` -> 450).
 * Strict: two-digit hour and minute, `'24:00'` refused.
 *
 * @throws TimeZoneError on any other shape.
 */
export function parseWallTime(hhmm: WallTime): number {
  const m = typeof hhmm === 'string' ? WALL_RE.exec(hhmm) : null;
  if (!m)
    throw new TimeZoneError(
      `Invalid wall time '${String(hhmm)}' — expected 'HH:mm' (00:00-23:59).`,
    );
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The wall time of `instant` in `zone`, as `'HH:mm'`. */
export function wallTimeOf(instant: Date, zone: string): WallTime {
  const { hour, minute } = localTimeParts(instant, zone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * The instant a civil date and an `'HH:mm'` wall time name in `zone`, with
 * Temporal's `disambiguation: 'compatible'` in every zone: a wall time that
 * happens twice (fall-back) is its EARLIER occurrence, and one that does not
 * exist (spring-forward gap) moves forward by the gap — New York 2026-03-08
 * 02:30 is 03:30 EDT, Berlin 2026-03-29 02:30 is 03:30 CEST.
 *
 * @throws TimeZoneError on a bad date, wall time or zone.
 */
export function wallInstant(date: CivilDate | string, hhmm: WallTime, zone: string): Date {
  return new Date(resolveWall(date, hhmm, zone, 'compatible'));
}

/**
 * Shared by {@link wallInstant} and the window helpers; they differ only for a
 * wall time inside a spring-forward gap. `'compatible'` moves it forward by
 * the gap (Temporal). `'boundary'` gives the moment the clock jumps: the first
 * instant whose wall reading is at or after the time. That is the monotone
 * choice a window boundary needs, so a window holds exactly the instants
 * whose wall clock reads inside it.
 */
function resolveWall(
  date: CivilDate | string,
  hhmm: WallTime,
  zone: string,
  gap: 'compatible' | 'boundary',
): number {
  const minutes = parseWallTime(hhmm);
  const cd = civilDate(date);
  const m = CIVIL_RE.exec(cd) as RegExpExecArray;
  const w = utcMs(Number(m[1]), Number(m[2]), Number(m[3]), Math.floor(minutes / 60), minutes % 60);
  // Offsets a day either side bracket any single transition near this wall time.
  const before = zoneOffsetMinutes(new Date(w - 86_400_000), zone);
  const after = zoneOffsetMinutes(new Date(w + 86_400_000), zone);
  let best: number | null = null;
  for (const offset of before === after ? [before] : [before, after]) {
    const candidate = w - offset * MINUTE_MS;
    const at = new Date(candidate);
    if (civilDateOf(at, zone) === cd && localTimeParts(at, zone).minutesOfDay === minutes) {
      if (best === null || candidate < best) best = candidate;
    }
  }
  if (best !== null) return best;
  // No candidate reads back: the wall time is in a gap. The pre-gap offset
  // carries it forward past the jump ('compatible').
  const forward = w - before * MINUTE_MS;
  if (gap === 'compatible' || after <= before) return forward;
  // 'boundary': the jump instant T lies in (w - after, w - before]. Before T
  // the wall reads below w, from T on at or above it; bisect to the ms.
  let lo = w - after * MINUTE_MS;
  let hi = forward;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid + zoneOffsetMinutes(new Date(mid), zone) * MINUTE_MS >= w) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * A daily wall-clock window: opening hours, a work shift, a quiet period.
 * Overnight when `end <= start` (`23:00`-`07:00` ends the next day);
 * `start === end` is a full 24-hour day.
 */
export interface WallWindow {
  start: WallTime;
  end: WallTime;
}

/** One occurrence of a keyed window: which window, the civil date it STARTED on, its instants. */
export interface WallWindowOccurrence<K extends string = string> {
  key: K;
  date: CivilDate;
  /** Half-open `[start, end)`. */
  range: DateRange;
}

/**
 * The instants of `window` starting on civil `date` in `zone`: half-open
 * `[start, end)`, the end on the next civil date when the window is overnight.
 * DST-exact: a 23:00-07:00 window across a fall-back night lasts 9 hours.
 *
 * The range holds exactly the instants whose wall clock reads inside the
 * window. A repeated fall-back time is its earlier occurrence, as in
 * {@link wallInstant}. A boundary inside a spring-forward gap is the moment
 * the clock jumps (New York 2026-03-08 02:30 is 07:00Z, 03:00 EDT), NOT
 * `wallInstant`'s forward-by-the-gap 03:30, which would drop 03:00-03:30
 * from a 02:30-04:00 window and hand it to the window before. So:
 * contiguous calendars stay contiguous and never overlap; a window wholly
 * inside the gap (02:15-02:45) is empty (`end === start`) and does not
 * start; a civil date the zone skipped entirely (Pacific/Apia 2011-12-30)
 * gives empty same-day windows. Never inverted.
 *
 * @throws TimeZoneError on a bad date, wall time or zone.
 */
export function resolveWallWindow(
  date: CivilDate | string,
  window: WallWindow,
  zone: string,
): DateRange {
  const cd = civilDate(date);
  const overnight = parseWallTime(window.end) <= parseWallTime(window.start);
  const start = resolveWall(cd, window.start, zone, 'boundary');
  const end = resolveWall(overnight ? addCivilDays(cd, 1) : cd, window.end, zone, 'boundary');
  return { start: new Date(start), end: new Date(Math.max(start, end)) };
}

/**
 * The keyed window in force at `instant` (start inclusive, end exclusive), or
 * `null` when no window covers it. An overnight window keeps the civil date it
 * started on: a 23:00-07:00 window at 02:00 on the 30th is the window of the
 * 29th. Matching compares instants, not wall minutes, so the repeated and the
 * skipped DST hour are attributed correctly. When windows overlap, the one
 * that started most recently wins (ties: array order).
 */
export function wallWindowAt<K extends string>(
  windows: readonly (WallWindow & { key: K })[],
  instant: Date,
  zone: string,
): WallWindowOccurrence<K> | null {
  const t = instant.getTime();
  if (!Number.isFinite(t)) throw new TimeZoneError('wallWindowAt: invalid instant.');
  const today = civilDateOf(instant, zone);
  let best: WallWindowOccurrence<K> | null = null;
  // A window starts on today or, if overnight, yesterday. Starts resolve
  // forward across a gap and never back past their own civil date.
  for (const date of [today, addCivilDays(today, -1)]) {
    for (const w of windows) {
      const range = resolveWallWindow(date, w, zone);
      if (range.start.getTime() <= t && t < range.end.getTime()) {
        if (best === null || range.start.getTime() > best.range.start.getTime()) {
          best = { key: w.key, date, range };
        }
      }
    }
  }
  return best;
}

/**
 * Every keyed window that STARTS in `(from, to]`, in start order: the
 * boundaries a scheduled job crosses between two ticks. A start exactly at
 * `from` belongs to the previous tick; an empty or reversed range gives `[]`.
 * A window that is empty that day (wholly inside a spring-forward gap, see
 * {@link resolveWallWindow}) does not start; one whose start is in the gap
 * starts when the clock jumps.
 *
 * Cost is one resolve per window per civil day in the range: clamp `from`
 * (for example to a lookback of a day or two) rather than passing the epoch
 * on a scheduler's first tick.
 */
export function wallWindowStartsBetween<K extends string>(
  windows: readonly (WallWindow & { key: K })[],
  from: Date,
  to: Date,
  zone: string,
): WallWindowOccurrence<K>[] {
  const lo = from.getTime();
  const hi = to.getTime();
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new TimeZoneError('wallWindowStartsBetween: invalid instant.');
  }
  if (hi <= lo) return [];
  const out: WallWindowOccurrence<K>[] = [];
  const last = civilDateOf(to, zone);
  for (
    let date = addCivilDays(civilDateOf(from, zone), -1);
    date <= last;
    date = addCivilDays(date, 1)
  ) {
    for (const w of windows) {
      const range = resolveWallWindow(date, w, zone);
      const s = range.start.getTime();
      if (s > lo && s <= hi && range.end.getTime() > s) out.push({ key: w.key, date, range });
    }
  }
  return out.sort((a, b) => a.range.start.getTime() - b.range.start.getTime());
}
