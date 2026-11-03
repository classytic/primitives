import { describe, expect, it } from 'vitest';
import {
  addCivilDays,
  addCivilMonths,
  type CivilDate,
  civilDate,
  civilDateToInstant,
  civilDaysBetween,
  isoWeekOfCivilDate,
  parseWallTime,
  resolveWallWindow,
  TimeZoneError,
  wallInstant,
  wallTimeOf,
  wallWindowAt,
  wallWindowStartsBetween,
} from '../../src/scheduling/timezone.js';

const RIYADH = 'Asia/Riyadh';
const NY = 'America/New_York';
const at = (iso: string) => new Date(iso);
const cd = (s: string) => civilDate(s);
const HOURS = 3_600_000;

const SHIFTS = [
  { key: 'E', start: '07:00', end: '15:00' },
  { key: 'L', start: '15:00', end: '23:00' },
  { key: 'N', start: '23:00', end: '07:00' },
] as const;

const keyDate = (o: { key: string; date: CivilDate } | null) => (o ? `${o.key}@${o.date}` : null);

describe('parseWallTime', () => {
  it('reads strict HH:mm', () => {
    expect(parseWallTime('00:00')).toBe(0);
    expect(parseWallTime('07:30')).toBe(450);
    expect(parseWallTime('23:59')).toBe(1439);
  });

  it('refuses anything else', () => {
    for (const bad of ['24:00', '7:00', '07:60', '0700', ' 07:00', '', '07:00:00']) {
      expect(() => parseWallTime(bad)).toThrow(TimeZoneError);
    }
    expect(() => parseWallTime(undefined as unknown as string)).toThrow(TimeZoneError);
  });
});

describe('wallTimeOf / wallInstant', () => {
  it('round-trip in a zone', () => {
    const instant = wallInstant('2026-10-30', '07:05', RIYADH);
    expect(instant.toISOString()).toBe('2026-10-30T04:05:00.000Z');
    expect(wallTimeOf(instant, RIYADH)).toBe('07:05');
    expect(wallTimeOf(at('2026-10-30T21:00:00Z'), RIYADH)).toBe('00:00');
  });

  it('validate the date and the wall time', () => {
    expect(() => wallInstant('2026-02-30', '07:00', RIYADH)).toThrow(TimeZoneError);
    expect(() => wallInstant('2026-02-03', '7:00', RIYADH)).toThrow(TimeZoneError);
  });
});

describe('resolveWallWindow', () => {
  it('a same-day window is [start, end) on that date', () => {
    const r = resolveWallWindow('2026-10-30', SHIFTS[0], RIYADH);
    expect(r.start.toISOString()).toBe('2026-10-30T04:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-30T12:00:00.000Z');
  });

  it('an overnight window ends the next civil day, across a year end too', () => {
    const r = resolveWallWindow('2026-12-31', SHIFTS[2], RIYADH);
    expect(r.start.toISOString()).toBe('2026-12-31T20:00:00.000Z');
    expect(r.end.toISOString()).toBe('2027-01-01T04:00:00.000Z');
  });

  it('start === end is a full day', () => {
    const r = resolveWallWindow('2026-10-30', { start: '06:00', end: '06:00' }, RIYADH);
    expect(r.end.getTime() - r.start.getTime()).toBe(24 * HOURS);
  });

  it('is DST-exact: 9 hours across fall-back, 7 across spring-forward', () => {
    const fall = resolveWallWindow('2026-10-31', SHIFTS[2], NY);
    expect(fall.end.getTime() - fall.start.getTime()).toBe(9 * HOURS);
    const spring = resolveWallWindow('2026-03-07', SHIFTS[2], NY);
    expect(spring.end.getTime() - spring.start.getTime()).toBe(7 * HOURS);
  });

  it('a full-day window across fall-back lasts 25 hours', () => {
    const r = resolveWallWindow('2026-10-31', { start: '12:00', end: '12:00' }, NY);
    expect(r.end.getTime() - r.start.getTime()).toBe(25 * HOURS);
  });
});

describe('wallWindowAt', () => {
  it('each boundary belongs to the window starting there', () => {
    expect(keyDate(wallWindowAt(SHIFTS, at('2026-10-30T04:00:00Z'), RIYADH))).toBe('E@2026-10-30');
    expect(keyDate(wallWindowAt(SHIFTS, at('2026-10-30T11:59:59.999Z'), RIYADH))).toBe(
      'E@2026-10-30',
    );
    expect(keyDate(wallWindowAt(SHIFTS, at('2026-10-30T12:00:00Z'), RIYADH))).toBe('L@2026-10-30');
    expect(keyDate(wallWindowAt(SHIFTS, at('2026-10-30T20:00:00Z'), RIYADH))).toBe('N@2026-10-30');
  });

  it('an overnight window keeps the date it started on', () => {
    // 02:00 on the 31st in Riyadh.
    expect(keyDate(wallWindowAt(SHIFTS, at('2026-10-30T23:00:00Z'), RIYADH))).toBe('N@2026-10-30');
    // 02:00 on 1 Jan 2027: still the Night window of 31 Dec.
    const o = wallWindowAt(SHIFTS, at('2026-12-31T23:00:00Z'), RIYADH);
    expect(keyDate(o)).toBe('N@2026-12-31');
    expect(o?.range.end.toISOString()).toBe('2027-01-01T04:00:00.000Z');
  });

  it('two-window and single full-day calendars', () => {
    const two = [
      { key: 'D', start: '07:00', end: '19:00' },
      { key: 'N', start: '19:00', end: '07:00' },
    ];
    expect(keyDate(wallWindowAt(two, at('2026-10-30T03:59:00Z'), RIYADH))).toBe('N@2026-10-29');
    expect(keyDate(wallWindowAt(two, at('2026-10-30T16:00:00Z'), RIYADH))).toBe('N@2026-10-30');
    const one = [{ key: 'A', start: '06:00', end: '06:00' }];
    expect(keyDate(wallWindowAt(one, at('2026-10-30T02:59:00Z'), RIYADH))).toBe('A@2026-10-29');
    expect(keyDate(wallWindowAt(one, at('2026-10-30T03:00:00Z'), RIYADH))).toBe('A@2026-10-30');
  });

  it('a gap is null, not a throw', () => {
    const office = [{ key: 'O', start: '08:00', end: '17:00' }];
    expect(wallWindowAt(office, at('2026-10-30T17:00:00Z'), RIYADH)).toBeNull();
    expect(wallWindowAt([], at('2026-10-30T17:00:00Z'), RIYADH)).toBeNull();
  });

  it('attributes the repeated DST hour by instant, not by wall minute', () => {
    const windows = [
      { key: 'A', start: '01:30', end: '09:00' },
      { key: 'B', start: '09:00', end: '01:30' },
    ];
    // 2026-11-01 New York: 01:15 happens twice, at 05:15Z (EDT) and 06:15Z (EST).
    // A starts at the FIRST 01:30 (05:30Z), so the second 01:15 is already inside A.
    expect(keyDate(wallWindowAt(windows, at('2026-11-01T05:15:00Z'), NY))).toBe('B@2026-10-31');
    expect(keyDate(wallWindowAt(windows, at('2026-11-01T06:15:00Z'), NY))).toBe('A@2026-11-01');
  });

  it('overlapping windows: the most recently started wins', () => {
    const windows = [
      { key: 'wide', start: '06:00', end: '20:00' },
      { key: 'peak', start: '12:00', end: '14:00' },
    ];
    expect(wallWindowAt(windows, at('2026-10-30T09:30:00Z'), RIYADH)?.key).toBe('peak');
    expect(wallWindowAt(windows, at('2026-10-30T11:30:00Z'), RIYADH)?.key).toBe('wide');
  });

  it('refuses an invalid instant', () => {
    expect(() => wallWindowAt(SHIFTS, new Date(Number.NaN), RIYADH)).toThrow(TimeZoneError);
  });
});

describe('wallWindowStartsBetween', () => {
  const list = (from: string, to: string) =>
    wallWindowStartsBetween(SHIFTS, at(from), at(to), RIYADH).map(keyDate);

  it('every start in (from, to], sorted across midnight and days', () => {
    expect(list('2026-10-30T03:00:00Z', '2026-10-31T05:00:00Z')).toEqual([
      'E@2026-10-30',
      'L@2026-10-30',
      'N@2026-10-30',
      'E@2026-10-31',
    ]);
  });

  it('a start exactly at `from` is excluded; exactly at `to` is included', () => {
    expect(list('2026-10-30T04:00:00Z', '2026-10-30T12:00:00Z')).toEqual(['L@2026-10-30']);
  });

  it('an empty or reversed range is []', () => {
    expect(list('2026-10-30T04:00:00Z', '2026-10-30T04:00:00Z')).toEqual([]);
    expect(list('2026-10-30T12:00:00Z', '2026-10-30T04:00:00Z')).toEqual([]);
  });

  it('carries the resolved range', () => {
    const [n] = wallWindowStartsBetween(
      [SHIFTS[2]],
      at('2026-10-30T19:00:00Z'),
      at('2026-10-30T21:00:00Z'),
      RIYADH,
    );
    expect(n?.range.start.toISOString()).toBe('2026-10-30T20:00:00.000Z');
    expect(n?.range.end.toISOString()).toBe('2026-10-31T04:00:00.000Z');
  });
});

describe('spring-forward gaps resolve forward in every zone', () => {
  const iso = (d: Date) => d.toISOString();

  it('wallInstant: a skipped time moves forward by the gap, west and east of UTC', () => {
    // New York 2026-03-08: 02:00 EST jumps to 03:00 EDT.
    expect(iso(wallInstant('2026-03-08', '02:30', NY))).toBe('2026-03-08T07:30:00.000Z');
    expect(iso(wallInstant('2026-03-08', '01:59', NY))).toBe('2026-03-08T06:59:00.000Z');
    expect(iso(wallInstant('2026-03-08', '03:00', NY))).toBe('2026-03-08T07:00:00.000Z');
    // Berlin 2026-03-29: 02:00 CET jumps to 03:00 CEST.
    expect(iso(wallInstant('2026-03-29', '02:30', 'Europe/Berlin'))).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('wallInstant: a repeated time is its earlier occurrence, west and east of UTC', () => {
    expect(iso(wallInstant('2026-11-01', '01:30', NY))).toBe('2026-11-01T05:30:00.000Z');
    // Berlin 2026-10-25: 02:30 happens at 00:30Z (CEST) and 01:30Z (CET).
    expect(iso(wallInstant('2026-10-25', '02:30', 'Europe/Berlin'))).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('a midnight gap keeps the civil date (America/Santiago)', () => {
    // 2026-09-06 00:00 -04 jumps to 01:00 -03.
    const z = 'America/Santiago';
    const s = wallInstant('2026-09-06', '00:30', z);
    expect(iso(s)).toBe('2026-09-06T04:30:00.000Z');
    const windows = [{ key: 'M', start: '00:30', end: '06:00' }];
    expect(keyDate(wallWindowAt(windows, at('2026-09-06T05:00:00Z'), z))).toBe('M@2026-09-06');
  });

  it('window boundaries inside the New York gap are the jump instant (07:00Z, 03:00 EDT)', () => {
    const a = resolveWallWindow('2026-03-08', { start: '01:45', end: '02:30' }, NY);
    expect(iso(a.start)).toBe('2026-03-08T06:45:00.000Z');
    expect(iso(a.end)).toBe('2026-03-08T07:00:00.000Z');
    const aw = [{ key: 'A', start: '01:45', end: '02:30' }];
    expect(keyDate(wallWindowAt(aw, at('2026-03-08T06:50:00Z'), NY))).toBe('A@2026-03-08');
    // 03:00 EDT reads past 02:30: A is over.
    expect(wallWindowAt(aw, at('2026-03-08T07:00:00Z'), NY)).toBeNull();

    // 02:30-07:00 keeps 03:00-03:30 EDT, which the clock showed.
    const b = resolveWallWindow('2026-03-08', { start: '02:30', end: '07:00' }, NY);
    expect(iso(b.start)).toBe('2026-03-08T07:00:00.000Z');
    expect(iso(b.end)).toBe('2026-03-08T11:00:00.000Z');

    const c = resolveWallWindow('2026-03-07', { start: '22:00', end: '02:30' }, NY);
    expect(iso(c.start)).toBe('2026-03-08T03:00:00.000Z');
    expect(iso(c.end)).toBe('2026-03-08T07:00:00.000Z');

    // Wholly inside the gap: the clock never reads 02:15-02:45, so it is empty.
    const inside = resolveWallWindow('2026-03-08', { start: '02:15', end: '02:45' }, NY);
    expect(iso(inside.start)).toBe('2026-03-08T07:00:00.000Z');
    expect(inside.end.getTime()).toBe(inside.start.getTime());
    const empty = resolveWallWindow('2026-03-08', { start: '02:30', end: '03:00' }, NY);
    expect(iso(empty.start)).toBe('2026-03-08T07:00:00.000Z');
    expect(empty.end.getTime()).toBe(empty.start.getTime());
  });

  it('a contiguous calendar through the gap stays contiguous and loses no wall time', () => {
    // A 22:00-02:30, B 02:30-03:15, C 03:15-22:00 on New York's spring-forward day.
    const windows = [
      { key: 'A', start: '22:00', end: '02:30' },
      { key: 'B', start: '02:30', end: '03:15' },
      { key: 'C', start: '03:15', end: '22:00' },
    ];
    const b = resolveWallWindow('2026-03-08', windows[1], NY);
    expect(iso(b.start)).toBe('2026-03-08T07:00:00.000Z');
    expect(iso(b.end)).toBe('2026-03-08T07:15:00.000Z');
    // The clock reads 01:59 EST, then 03:00 and 03:10 EDT (inside B), then 03:15 EDT.
    expect(keyDate(wallWindowAt(windows, at('2026-03-08T06:59:00Z'), NY))).toBe('A@2026-03-07');
    expect(keyDate(wallWindowAt(windows, at('2026-03-08T07:00:00Z'), NY))).toBe('B@2026-03-08');
    expect(keyDate(wallWindowAt(windows, at('2026-03-08T07:10:00Z'), NY))).toBe('B@2026-03-08');
    expect(keyDate(wallWindowAt(windows, at('2026-03-08T07:15:00Z'), NY))).toBe('C@2026-03-08');
    const starts = wallWindowStartsBetween(
      windows,
      at('2026-03-08T06:00:00Z'),
      at('2026-03-08T08:00:00Z'),
      NY,
    );
    expect(starts.map(keyDate)).toEqual(['B@2026-03-08', 'C@2026-03-08']);
    expect(starts.map((o) => iso(o.range.start))).toEqual([
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T07:15:00.000Z',
    ]);
    // Each window ends where the next begins.
    const a = resolveWallWindow('2026-03-07', windows[0], NY);
    const c = resolveWallWindow('2026-03-08', windows[2], NY);
    expect(a.end.getTime()).toBe(b.start.getTime());
    expect(b.end.getTime()).toBe(c.start.getTime());
  });

  it('wallWindowStartsBetween: gap starts fire at the jump; empty windows do not start', () => {
    const windows = [
      { key: 'S', start: '02:30', end: '07:00' },
      { key: 'X', start: '02:30', end: '03:00' },
      { key: 'Y', start: '02:15', end: '02:45' },
    ];
    const got = wallWindowStartsBetween(
      windows,
      at('2026-03-08T06:00:00Z'),
      at('2026-03-08T08:00:00Z'),
      NY,
    );
    expect(got.map(keyDate)).toEqual(['S@2026-03-08']);
    expect(got[0]?.range.start.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });

  it('east of UTC and at a 30-minute gap too (Berlin, Lord Howe)', () => {
    // Berlin 2026-03-29: 02:00 CET (01:00Z) jumps to 03:00 CEST.
    const berlin = resolveWallWindow(
      '2026-03-29',
      { start: '02:30', end: '04:00' },
      'Europe/Berlin',
    );
    expect(iso(berlin.start)).toBe('2026-03-29T01:00:00.000Z');
    expect(iso(berlin.end)).toBe('2026-03-29T02:00:00.000Z');
    // Lord Howe 2026-10-04: 02:00 +10:30 (15:30Z on the 3rd) jumps to 02:30 +11.
    const lh = resolveWallWindow(
      '2026-10-04',
      { start: '02:15', end: '03:00' },
      'Australia/Lord_Howe',
    );
    expect(iso(lh.start)).toBe('2026-10-03T15:30:00.000Z');
    expect(iso(lh.end)).toBe('2026-10-03T16:00:00.000Z');
  });

  it('a skipped civil day gives no duplicate start (Pacific/Apia 2011-12-30)', () => {
    const z = 'Pacific/Apia';
    const noon = [{ key: 'A', start: '12:00', end: '13:00' }];
    const got = wallWindowStartsBetween(
      noon,
      at('2011-12-29T00:00:00Z'),
      at('2011-12-31T12:00:00Z'),
      z,
    );
    // 12:00 on the 29th (-10) and on the 31st (+14); the 30th never happened.
    expect(got.map(keyDate)).toEqual(['A@2011-12-29', 'A@2011-12-31']);
    expect(got.map((o) => iso(o.range.start))).toEqual([
      '2011-12-29T22:00:00.000Z',
      '2011-12-30T22:00:00.000Z',
    ]);
    const skipped = resolveWallWindow('2011-12-30', noon[0], z);
    expect(skipped.end.getTime()).toBe(skipped.start.getTime());
    expect(keyDate(wallWindowAt(noon, at('2011-12-30T22:30:00Z'), z))).toBe('A@2011-12-31');
  });
});

describe('parity with the app interim it replaces (G-REG-1)', () => {
  it('London fall-back night: 23:00 BST to 07:00 GMT, exact instants', () => {
    const r = resolveWallWindow('2026-10-24', SHIFTS[2], 'Europe/London');
    expect(r.start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });

  it('the next window is the one in force at the current window end', () => {
    const now = wallWindowAt(SHIFTS, at('2026-10-30T22:00:00Z'), RIYADH);
    expect(keyDate(now)).toBe('N@2026-10-30');
    const next = now ? wallWindowAt(SHIFTS, now.range.end, RIYADH) : null;
    expect(keyDate(next)).toBe('E@2026-10-31');
    expect(next?.range.start.toISOString()).toBe('2026-10-31T04:00:00.000Z');
    expect(next?.range.end.toISOString()).toBe('2026-10-31T12:00:00.000Z');
  });

  it('a 24-hour window beside a shorter one: the most recently started wins', () => {
    const windows = [
      { key: 'post', start: '06:00', end: '06:00' },
      { key: 'peak', start: '17:00', end: '19:00' },
    ];
    expect(keyDate(wallWindowAt(windows, at('2026-10-30T02:00:00Z'), RIYADH))).toBe(
      'post@2026-10-29',
    );
    expect(keyDate(wallWindowAt(windows, at('2026-10-30T14:30:00Z'), RIYADH))).toBe(
      'peak@2026-10-30',
    );
  });

  it('results do not depend on the process zone (UTC+14 and a DST zone)', () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ['Pacific/Kiritimati', 'America/New_York', 'UTC']) {
        process.env.TZ = tz;
        expect(keyDate(wallWindowAt(SHIFTS, at('2026-10-30T23:00:00Z'), RIYADH))).toBe(
          'N@2026-10-30',
        );
        expect(wallInstant('2026-10-30', '07:00', RIYADH).toISOString()).toBe(
          '2026-10-30T04:00:00.000Z',
        );
        expect(
          wallWindowStartsBetween(
            SHIFTS,
            at('2026-10-30T03:00:00Z'),
            at('2026-10-31T04:00:00Z'),
            RIYADH,
          ).map(keyDate),
        ).toEqual(['E@2026-10-30', 'L@2026-10-30', 'N@2026-10-30', 'E@2026-10-31']);
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});

describe('years 0000-0099 (valid civil dates, not 1900-1999)', () => {
  it('addCivilDays, civilDaysBetween, isoWeekOfCivilDate stay in the right year', () => {
    expect(addCivilDays(cd('0000-02-29'), 1)).toBe('0000-03-01');
    expect(addCivilDays(cd('0050-12-31'), 1)).toBe('0051-01-01');
    expect(addCivilDays(cd('0099-12-31'), 1)).toBe('0100-01-01');
    expect(civilDaysBetween(cd('0099-12-31'), cd('0100-01-01'))).toBe(1);
    expect(civilDaysBetween(cd('0050-01-01'), cd('0051-01-01'))).toBe(365);
    expect(isoWeekOfCivilDate(cd('0050-06-01'))).toMatch(/^0050-W\d{2}$/);
    expect(isoWeekOfCivilDate(cd('2025-12-29'))).toBe('2026-W01');
  });

  it('civilDateToInstant and resolveWallWindow keep the year', () => {
    expect(civilDateToInstant(cd('0050-06-01'), 'UTC', { hour: 7 }).toISOString()).toBe(
      '0050-06-01T07:00:00.000Z',
    );
    const r = resolveWallWindow('0050-06-01', SHIFTS[2], 'UTC');
    expect(r.start.toISOString()).toBe('0050-06-01T23:00:00.000Z');
    expect(r.end.toISOString()).toBe('0050-06-02T07:00:00.000Z');
  });
});

describe('addCivilMonths', () => {
  it('clamps to the last day of the target month', () => {
    expect(addCivilMonths(cd('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addCivilMonths(cd('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addCivilMonths(cd('2026-03-31'), -1)).toBe('2026-02-28');
  });

  it('crosses year boundaries both ways', () => {
    expect(addCivilMonths(cd('2026-01-15'), -1)).toBe('2025-12-15');
    expect(addCivilMonths(cd('2026-11-30'), 3)).toBe('2027-02-28');
    expect(addCivilMonths(cd('2026-05-10'), 12)).toBe('2027-05-10');
    expect(addCivilMonths(cd('2026-05-10'), -25)).toBe('2024-04-10');
  });

  it('handles year 0000 (an ISO leap year) and refuses leaving 0000-9999', () => {
    expect(addCivilMonths(cd('0000-01-31'), 1)).toBe('0000-02-29');
    expect(addCivilMonths(cd('0050-01-31'), 1)).toBe('0050-02-28');
    expect(() => addCivilMonths(cd('0000-01-31'), -1)).toThrow(RangeError);
    expect(() => addCivilMonths(cd('9999-12-01'), 1)).toThrow(RangeError);
  });

  it('+0 is identity', () => {
    expect(addCivilMonths(cd('2026-05-31'), 0)).toBe('2026-05-31');
  });

  it('refuses an invalid date or a non-integer month count', () => {
    expect(() => addCivilMonths('2026-02-30' as CivilDate, 1)).toThrow(TimeZoneError);
    expect(() => addCivilMonths('2026-2-3' as CivilDate, 1)).toThrow(TimeZoneError);
    expect(() => addCivilMonths(cd('2026-02-03'), 1.5)).toThrow(RangeError);
    expect(() => addCivilMonths(cd('2026-02-03'), Number.NaN)).toThrow(RangeError);
  });
});
