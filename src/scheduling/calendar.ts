/**
 * Calendar boundaries + arithmetic — the ONE place the stack computes
 * "start of day / month", weekday, and month/day/year addition, so no package
 * hand-rolls it with server-LOCAL `Date` methods (`getFullYear`/`getMonth`/
 * `getDate`/`getDay`), which silently shift with the deploy machine's `TZ` env.
 *
 * Every function is PURE and takes a fixed **UTC offset in minutes** (east of
 * UTC — `360` = UTC+6 / Asia-Dhaka). Same convention as `cadence` / `sla-policy`:
 * no IANA tz database, no DST. A fixed offset is exact for zones without DST
 * (e.g. Bangladesh, India, most of Asia) and is what a "daily limit resets at
 * local midnight" boundary needs. For DST-correct wall-clock math the host
 * resolves the offset for the instant and passes it in.
 *
 * `Date` instants are UTC epoch and timezone-independent — these helpers only
 * decide WHERE the day/month boundary falls, never how "now" is recorded.
 *
 * Resolving that offset from an IANA zone name is `/timezone`'s job — the
 * two compose: `startOfMonth(instant, zoneOffsetMinutes(instant, zone))`.
 * For a DST-exact DAY boundary prefer the civil-date round-trip from
 * `/timezone`: `civilDateToInstant(civilDateOf(instant, zone), zone)`.
 */

/** Minutes east of UTC. `0` = UTC, `360` = UTC+6 (Asia/Dhaka), `-300` = UTC-5. */
export type UtcOffsetMinutes = number;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * The absolute instant of local midnight for the day CONTAINING `instant`, in
 * the given offset. `startOfDay(2026-07-02T03:00Z, 360)` → `2026-07-01T18:00Z`
 * (Dhaka midnight). With `offsetMinutes = 0` it's plain UTC midnight.
 */
export function startOfDay(instant: Date, offsetMinutes: UtcOffsetMinutes = 0): Date {
  const shifted = new Date(instant.getTime() + offsetMinutes * MINUTE_MS);
  const localMidnightAsUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(localMidnightAsUtc - offsetMinutes * MINUTE_MS);
}

/** The absolute instant of the first-of-month midnight, in the given offset. */
export function startOfMonth(instant: Date, offsetMinutes: UtcOffsetMinutes = 0): Date {
  const shifted = new Date(instant.getTime() + offsetMinutes * MINUTE_MS);
  const localFirstAsUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1);
  return new Date(localFirstAsUtc - offsetMinutes * MINUTE_MS);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of `instant` in the given offset. */
export function isoWeekday(instant: Date, offsetMinutes: UtcOffsetMinutes = 0): number {
  const shifted = new Date(instant.getTime() + offsetMinutes * MINUTE_MS);
  return ((shifted.getUTCDay() + 6) % 7) + 1;
}

/** Add whole days as an exact 24h × n duration (offset-agnostic, no DST skew). */
export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY_MS);
}

/**
 * Add calendar months in UTC, clamping the day so month-ends never overflow
 * (`addMonths(Jan 31, 1)` → Feb 28/29). Use for subscription/access periods
 * instead of local `setMonth(getMonth() + n)`.
 */
export function addMonths(instant: Date, months: number): Date {
  const d = new Date(instant.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const daysInTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInTarget));
  return d;
}

/** Add calendar years in UTC (clamps Feb 29 → Feb 28 on non-leap years). */
export function addYears(instant: Date, years: number): Date {
  return addMonths(instant, years * 12);
}
