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

const OFFSET_RE = /GMT(?:([+-])(\d{2}):(\d{2}))?/;

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

/** Runtime guard for external input. */
export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== 'string') return false;
  const m = CIVIL_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
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
 * wall time that does not exist (inside a spring-forward gap) resolves to
 * the instant the shifted clock reaches — the same choice Temporal's
 * `disambiguation: 'compatible'` makes.
 */
export function civilDateToInstant(
  cd: CivilDate,
  zone: string,
  time: { hour?: number; minute?: number } = {},
): Date {
  const m = CIVIL_RE.exec(cd);
  if (!m) throw new TimeZoneError(`Invalid civil date '${cd}'.`);
  const hour = time.hour ?? 0;
  const minute = time.minute ?? 0;
  const wallAsUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute);

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
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return civilDate(`${y}-${mo}-${day}`);
}

/**
 * Whole days from `a` to `b` (positive when `b` is later) — the NIGHTS
 * count for a `[checkIn, checkOut)` stay expressed as civil dates.
 */
export function civilDaysBetween(a: CivilDate, b: CivilDate): number {
  const pa = CIVIL_RE.exec(a);
  const pb = CIVIL_RE.exec(b);
  if (!pa || !pb) throw new TimeZoneError(`Invalid civil date '${!pa ? a : b}'.`);
  const ma = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  const mb = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  return Math.round((mb - ma) / 86_400_000);
}
