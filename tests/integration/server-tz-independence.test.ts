/**
 * Deep test — SERVER-TZ INDEPENDENCE, proven with real processes.
 *
 * The whole point of `/calendar` + `/timezone` is that the deploy machine's
 * `TZ` env must never change a result. In-process tests cannot prove that
 * (Node reads TZ once at startup), so this suite spawns CHILD Node processes
 * with the built dist under servers "in different countries" — a UTC box, a
 * New York box, a Dhaka box, a Kiritimati box (UTC+14, the earliest clock on
 * Earth) — runs identical computations in each, and requires byte-identical
 * output, which must ALSO equal the hand-computed expected instants.
 *
 * If any function regresses to a local Date method (`getFullYear`,
 * `setMonth`, `setHours`, ...), the four servers disagree and this fails.
 *
 * Platform note: runtime TZ-env support varies (notably Windows). Each child
 * first PROBES that its TZ actually took effect (`getTimezoneOffset` of a
 * known instant); zones whose probe fails are skipped honestly — the
 * remaining zones (always including UTC) still assert full equality.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIST = path.resolve(import.meta.dirname, '../../dist');
const calendarUrl = pathToFileURL(path.join(DIST, 'calendar.mjs')).href;
const timezoneUrl = pathToFileURL(path.join(DIST, 'timezone.mjs')).href;

/** Server "countries" + the expected getTimezoneOffset probe for 2026-07-01T12:00Z. */
const SERVERS: Array<{ tz: string; probe: number }> = [
  { tz: 'UTC', probe: 0 },
  { tz: 'America/New_York', probe: 240 }, // EDT in July
  { tz: 'Asia/Dhaka', probe: -360 },
  { tz: 'Pacific/Kiritimati', probe: -840 }, // UTC+14
];

const CHILD_SCRIPT = `
import { startOfDay, startOfMonth, addDays, addMonths, addYears, isoWeekday } from '${calendarUrl}';
import { civilDateOf, civilDateToInstant, zoneOffsetMinutes, localTimeParts } from '${timezoneUrl}';
const out = {
  probe: new Date('2026-07-01T12:00:00Z').getTimezoneOffset(),
  // /calendar — fixed-offset arithmetic
  dhakaDayStart: startOfDay(new Date('2026-07-01T19:00:00Z'), 360).toISOString(),
  dhakaMonthStart: startOfMonth(new Date('2026-07-31T18:10:00Z'), 360).toISOString(),
  monthEndClamp: addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString(),
  leapClamp: addYears(new Date('2028-02-29T12:00:00Z'), 1).toISOString(),
  plusThirty: addDays(new Date('2026-02-27T23:30:00Z'), 30).toISOString(),
  weekdayInNepal: isoWeekday(new Date('2026-07-04T18:20:00Z'), 345),
  // /timezone — IANA resolution (DST-exact)
  dhakaCivil: String(civilDateOf(new Date('2026-07-01T19:00:00Z'), 'Asia/Dhaka')),
  nyMidnightEdt: civilDateToInstant('2026-11-01', 'America/New_York').toISOString(),
  nyMidnightEst: civilDateToInstant('2026-11-02', 'America/New_York').toISOString(),
  nySummerOffset: zoneOffsetMinutes(new Date('2026-07-01T00:00:00Z'), 'America/New_York'),
  nyWinterOffset: zoneOffsetMinutes(new Date('2026-01-01T00:00:00Z'), 'America/New_York'),
  kathmanduOffset: zoneOffsetMinutes(new Date('2026-07-01T00:00:00Z'), 'Asia/Kathmandu'),
  dhakaWall: localTimeParts(new Date('2026-07-01T18:01:00Z'), 'Asia/Dhaka'),
};
console.log(JSON.stringify(out));
`;

interface ChildResult {
  probe: number;
  [key: string]: unknown;
}

function runOnServerIn(tz: string): ChildResult {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
    timeout: 20_000,
  });
  return JSON.parse(stdout.trim()) as ChildResult;
}

describe('server-TZ independence (child processes in 4 countries)', () => {
  it('every server computes the SAME instants — and the RIGHT ones', () => {
    const results = SERVERS.map((s) => ({ ...s, out: runOnServerIn(s.tz) }));

    // Honest platform probe: only compare servers whose TZ actually applied.
    const effective = results.filter((r) => r.out['probe'] === r.probe);
    expect(effective.length, 'at least the UTC server must probe correctly').toBeGreaterThanOrEqual(1);
    if (effective.length < results.length) {
      const skipped = results.filter((r) => r.out['probe'] !== r.probe).map((r) => r.tz);
      console.warn(`[server-tz] runtime ignored TZ env for: ${skipped.join(', ')} — comparing the rest`);
    }

    const expected = {
      dhakaDayStart: '2026-07-01T18:00:00.000Z', // Jul 2 00:00 Dhaka
      dhakaMonthStart: '2026-07-31T18:00:00.000Z', // Aug 1 00:00 Dhaka
      monthEndClamp: '2026-02-28T00:00:00.000Z', // Jan 31 + 1mo, non-leap
      leapClamp: '2029-02-28T12:00:00.000Z', // Feb 29 + 1y
      plusThirty: '2026-03-29T23:30:00.000Z', // exact 30 × 24h
      weekdayInNepal: 7, // Jul 5 in Kathmandu (UTC+5:45) is a Sunday
      dhakaCivil: '2026-07-02',
      nyMidnightEdt: '2026-11-01T04:00:00.000Z', // midnight EDT
      nyMidnightEst: '2026-11-02T05:00:00.000Z', // midnight EST — DST-exact
      nySummerOffset: -240,
      nyWinterOffset: -300,
      kathmanduOffset: 345,
      dhakaWall: { isoWeekday: 4, hour: 0, minute: 1, minutesOfDay: 1 }, // Thu Jul 2, 00:01
    };

    for (const server of effective) {
      const { probe: _probe, ...computed } = server.out;
      expect(computed, `server in ${server.tz}`).toEqual(expected);
    }
  });
});
