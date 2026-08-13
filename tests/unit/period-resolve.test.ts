/**
 * Period → DateRange resolution, in a business timezone.
 *
 * These are the regression tests for the UTC-month bug class: every assertion
 * that names an instant would ALSO pass against a `Date.UTC`-based resolver if
 * the zone were UTC, so each one is written against a non-UTC zone where the
 * two answers differ.
 */

import { describe, expect, it } from 'vitest';
import {
  dayStart,
  formatPeriod,
  granularityOf,
  inclusiveEnd,
  PeriodError,
  parsePeriod,
  periodOf,
  periodTimeZone,
  resolveDateSpan,
  shiftPeriod,
  resolveDay,
  resolveMonth,
  resolvePeriod,
  resolveQuarter,
  resolveYear,
} from '../../src/scheduling/period.js';

const DHAKA = 'Asia/Dhaka'; // UTC+6, no DST
const NY = 'America/New_York'; // UTC-5 / -4, DST

const iso = (d: Date) => d.toISOString();

describe('resolveMonth — the business month, not the UTC month', () => {
  it('starts and ends six hours before the UTC month in Asia/Dhaka', () => {
    const august = resolveMonth(2026, 8, DHAKA);
    expect(iso(august.start)).toBe('2026-07-31T18:00:00.000Z');
    expect(iso(august.end)).toBe('2026-08-31T18:00:00.000Z');
  });

  it('places a 2026-08-01 00:30 Dhaka posting INSIDE August (a UTC month puts it in July)', () => {
    // 2026-07-31T18:30Z === 2026-08-01T00:30 Dhaka.
    const posting = new Date('2026-07-31T18:30:00.000Z');
    const august = resolveMonth(2026, 8, DHAKA);
    const july = resolveMonth(2026, 7, DHAKA);

    expect(posting >= august.start && posting < august.end).toBe(true);
    expect(posting >= july.start && posting < july.end).toBe(false);

    // The bug being guarded: Date.UTC would file this under July.
    const utcJulyEnd = new Date(Date.UTC(2026, 7, 1));
    expect(posting < utcJulyEnd).toBe(true);
  });

  it('rolls the year at December', () => {
    const december = resolveMonth(2026, 12, DHAKA);
    expect(iso(december.end)).toBe('2026-12-31T18:00:00.000Z');
    expect(iso(december.end)).toBe(iso(resolveMonth(2027, 1, DHAKA).start));
  });

  it('is DST-exact: a March month in New York is 1h shorter than 31 nominal days', () => {
    const march = resolveMonth(2026, 3, NY);
    expect(iso(march.start)).toBe('2026-03-01T05:00:00.000Z'); // EST, UTC-5
    expect(iso(march.end)).toBe('2026-04-01T04:00:00.000Z'); // EDT, UTC-4
    const hours = (march.end.getTime() - march.start.getTime()) / 3_600_000;
    expect(hours).toBe(31 * 24 - 1);
  });

  it('tiles exactly — every month end IS the next month start', () => {
    for (let m = 1; m <= 11; m++) {
      expect(resolveMonth(2026, m, NY).end.getTime()).toBe(
        resolveMonth(2026, m + 1, NY).start.getTime(),
      );
    }
  });

  it('rejects an out-of-range month rather than wrapping it', () => {
    expect(() => resolveMonth(2026, 0, DHAKA)).toThrow(PeriodError);
    expect(() => resolveMonth(2026, 13, DHAKA)).toThrow(PeriodError);
    expect(() => resolveMonth(2026, 1.5, DHAKA)).toThrow(PeriodError);
  });

  it('rejects a missing or unknown timezone rather than answering in UTC', () => {
    // @ts-expect-error — the point of the test is the runtime guard.
    expect(() => resolveMonth(2026, 8, undefined)).toThrow(/needs an IANA timezone/);
    expect(() => resolveMonth(2026, 8, '')).toThrow(PeriodError);
    expect(() => resolveMonth(2026, 8, 'Asia/Dacca_Typo')).toThrow(/Unknown IANA timezone/);
  });
});

describe('resolveDay / dayStart', () => {
  it('is local midnight, not UTC midnight', () => {
    expect(iso(dayStart('2026-08-15', DHAKA))).toBe('2026-08-14T18:00:00.000Z');
  });

  it('returns a half-open 24h range in a fixed-offset zone', () => {
    const day = resolveDay('2026-08-15', DHAKA);
    expect(iso(day.start)).toBe('2026-08-14T18:00:00.000Z');
    expect(iso(day.end)).toBe('2026-08-15T18:00:00.000Z');
  });

  it('is 23h on a spring-forward day (never start + 24h)', () => {
    const springForward = resolveDay('2026-03-08', NY);
    expect((springForward.end.getTime() - springForward.start.getTime()) / 3_600_000).toBe(23);
  });

  it('is 25h on a fall-back day', () => {
    const fallBack = resolveDay('2026-11-01', NY);
    expect((fallBack.end.getTime() - fallBack.start.getTime()) / 3_600_000).toBe(25);
  });

  it('rejects a malformed civil date', () => {
    expect(() => resolveDay('2026-13-01', DHAKA)).toThrow();
    expect(() => resolveDay('15/08/2026', DHAKA)).toThrow();
  });
});

describe('resolveQuarter / resolveYear', () => {
  it('Q3 spans July–September on the local calendar', () => {
    const q3 = resolveQuarter(2026, 3, DHAKA);
    expect(iso(q3.start)).toBe('2026-06-30T18:00:00.000Z');
    expect(iso(q3.end)).toBe('2026-09-30T18:00:00.000Z');
  });

  it('quarters tile the year exactly', () => {
    const year = resolveYear(2026, NY);
    expect(resolveQuarter(2026, 1, NY).start.getTime()).toBe(year.start.getTime());
    expect(resolveQuarter(2026, 4, NY).end.getTime()).toBe(year.end.getTime());
    for (const q of [1, 2, 3] as const) {
      expect(resolveQuarter(2026, q, NY).end.getTime()).toBe(
        resolveQuarter(2026, (q + 1) as 2 | 3 | 4, NY).start.getTime(),
      );
    }
  });

  it('the local year starts before the UTC year in an east-of-UTC zone', () => {
    const year = resolveYear(2026, DHAKA);
    expect(iso(year.start)).toBe('2025-12-31T18:00:00.000Z');
    expect(iso(year.end)).toBe('2026-12-31T18:00:00.000Z');
  });

  it('rejects an out-of-range quarter', () => {
    // @ts-expect-error — runtime guard, not just the type.
    expect(() => resolveQuarter(2026, 5, DHAKA)).toThrow(PeriodError);
  });
});

describe('resolveDateSpan', () => {
  it('is inclusive of BOTH named days', () => {
    const span = resolveDateSpan('2026-08-01', '2026-08-31', DHAKA);
    expect(span.start.getTime()).toBe(resolveMonth(2026, 8, DHAKA).start.getTime());
    expect(span.end.getTime()).toBe(resolveMonth(2026, 8, DHAKA).end.getTime());
  });

  it('rejects a reversed span', () => {
    expect(() => resolveDateSpan('2026-08-31', '2026-08-01', DHAKA)).toThrow(PeriodError);
  });
});

describe('resolvePeriod', () => {
  it('resolves a month period', () => {
    expect(resolvePeriod({ year: 2026, month: 8 }, DHAKA)).toEqual(resolveMonth(2026, 8, DHAKA));
  });

  it('resolves a quarter period', () => {
    expect(resolvePeriod({ year: 2026, quarter: 3 }, DHAKA)).toEqual(
      resolveQuarter(2026, 3, DHAKA),
    );
  });

  it('resolves a bare year period', () => {
    expect(resolvePeriod({ year: 2026 }, DHAKA)).toEqual(resolveYear(2026, DHAKA));
  });

  it('uses the period’s OWN zone when the caller supplies none', () => {
    expect(resolvePeriod({ year: 2026, month: 8, timezone: DHAKA })).toEqual(
      resolveMonth(2026, 8, DHAKA),
    );
  });

  it('THROWS when the period’s zone and the caller’s zone disagree', () => {
    expect(() => resolvePeriod({ year: 2026, month: 8, timezone: DHAKA }, NY)).toThrow(
      /different calendars/,
    );
  });

  it('THROWS when no zone is available anywhere — never falls back to UTC', () => {
    expect(() => resolvePeriod({ year: 2026, month: 8 })).toThrow(/needs an IANA timezone/);
  });

  it('THROWS on a period carrying two resolution shapes', () => {
    expect(() => resolvePeriod({ year: 2026, month: 8, quarter: 3 }, DHAKA)).toThrow(
      /more than one resolution shape/,
    );
    expect(() =>
      resolvePeriod({ year: 2026, month: 8, start: new Date(), end: new Date() }, DHAKA),
    ).toThrow(/more than one resolution shape/);
  });

  it('THROWS on a half-supplied ad-hoc range', () => {
    expect(() => resolvePeriod({ year: 2026, start: new Date('2026-01-01') }, DHAKA)).toThrow(
      /needs BOTH start and end/,
    );
  });

  it('passes an ad-hoc range through and needs no zone', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-02-01T00:00:00Z');
    expect(resolvePeriod({ year: 2026, start, end })).toEqual({ start, end });
  });

  it('rejects an ad-hoc range with an Invalid Date endpoint', () => {
    expect(() => resolvePeriod({ year: 2026, start: new Date('nope'), end: new Date() })).toThrow();
  });
});

describe('periodOf — which period does this instant belong to', () => {
  it('names the LOCAL month, not the UTC one', () => {
    // 00:30 on 1 August in Dhaka; 31 July in UTC.
    const instant = new Date('2026-07-31T18:30:00.000Z');
    expect(periodOf(instant, 'month', DHAKA)).toEqual({ year: 2026, month: 8, timezone: DHAKA });
    expect(instant.getUTCMonth() + 1).toBe(7); // what the naive answer would have been
  });

  it('names the LOCAL year — a 01:00 1-Jan document belongs to the incoming year', () => {
    const instant = new Date('2025-12-31T19:00:00.000Z'); // 01:00 1 Jan 2026 Dhaka
    expect(periodOf(instant, 'year', DHAKA)).toEqual({ year: 2026, timezone: DHAKA });
    expect(instant.getUTCFullYear()).toBe(2025);
  });

  it('names the quarter', () => {
    expect(periodOf(new Date('2026-08-15T06:00:00Z'), 'quarter', DHAKA)).toEqual({
      year: 2026,
      quarter: 3,
      timezone: DHAKA,
    });
  });

  it('round-trips: an instant resolves back into the period it names', () => {
    const instant = new Date('2026-07-31T18:30:00.000Z');
    const range = resolvePeriod(periodOf(instant, 'month', DHAKA));
    expect(instant >= range.start && instant < range.end).toBe(true);
  });
});

describe('parsePeriod / formatPeriod', () => {
  it('parses the three label shapes', () => {
    expect(parsePeriod('2026')).toEqual({ year: 2026 });
    expect(parsePeriod('2026-08')).toEqual({ year: 2026, month: 8 });
    expect(parsePeriod('2026-Q3')).toEqual({ year: 2026, quarter: 3 });
  });

  it('binds a zone when one is supplied', () => {
    expect(parsePeriod('2026-08', DHAKA)).toEqual({ year: 2026, month: 8, timezone: DHAKA });
  });

  it('REFUSES a civil date instead of silently reading it as its month', () => {
    expect(() => parsePeriod('2026-08-15')).toThrow(/civil DATE, not a period label/);
  });

  it('refuses a partial / unanchored label rather than reading the part it recognises', () => {
    expect(() => parsePeriod('2026-08-')).toThrow(PeriodError);
    expect(() => parsePeriod('FY2026')).toThrow(PeriodError);
    expect(() => parsePeriod('2026-q3')).toThrow(PeriodError);
    expect(() => parsePeriod('2026-13')).toThrow(PeriodError);
  });

  it('round-trips label → period → label', () => {
    for (const label of ['2026', '2026-08', '2026-Q3']) {
      expect(formatPeriod(parsePeriod(label))).toBe(label);
    }
  });

  it('has no label for an ad-hoc period', () => {
    expect(() => formatPeriod({ year: 2026, start: new Date(), end: new Date() })).toThrow(
      PeriodError,
    );
  });
});

describe('granularityOf / periodTimeZone / inclusiveEnd', () => {
  it('classifies each shape', () => {
    expect(granularityOf({ year: 2026 })).toBe('year');
    expect(granularityOf({ year: 2026, month: 8 })).toBe('month');
    expect(granularityOf({ year: 2026, quarter: 3 })).toBe('quarter');
    expect(granularityOf({ year: 2026, start: new Date(), end: new Date() })).toBe('custom');
  });

  it('periodTimeZone prefers the period’s own zone and rejects a conflict', () => {
    expect(periodTimeZone({ year: 2026, timezone: DHAKA })).toBe(DHAKA);
    expect(periodTimeZone({ year: 2026 }, NY)).toBe(NY);
    expect(periodTimeZone({ year: 2026, timezone: DHAKA }, DHAKA)).toBe(DHAKA);
    expect(() => periodTimeZone({ year: 2026, timezone: DHAKA }, NY)).toThrow(PeriodError);
  });

  it('inclusiveEnd is the last instant, derived from the half-open end', () => {
    const august = resolveMonth(2026, 8, DHAKA);
    expect(iso(inclusiveEnd(august))).toBe('2026-08-31T17:59:59.999Z');
  });

  it('inclusiveEnd stays DST-exact — never start + 24h - 1', () => {
    const springForward = resolveDay('2026-03-08', NY);
    expect(inclusiveEnd(springForward).getTime()).toBe(springForward.end.getTime() - 1);
    expect(inclusiveEnd(springForward).getTime()).not.toBe(
      springForward.start.getTime() + 86_400_000 - 1,
    );
  });
});

/**
 * Period ARITHMETIC — `shiftPeriod`.
 *
 * The rule these pin: shifting a calendar period is `(year, month)` math and
 * must construct NO instant. Every assertion below uses a non-UTC zone, so a
 * reimplementation that reached for `Date.UTC` to do the rollover would resolve
 * to different instants and fail here rather than six hours later in a filing.
 */
describe('shiftPeriod', () => {
  const DHAKA = 'Asia/Dhaka';

  it('shifts months back across a year boundary', () => {
    expect(shiftPeriod({ year: 2026, month: 1, timezone: DHAKA }, -2)).toEqual({
      year: 2025,
      month: 11,
      timezone: DHAKA,
    });
  });

  it('shifts months forward across a year boundary', () => {
    expect(shiftPeriod({ year: 2026, month: 12, timezone: DHAKA }, 1)).toEqual({
      year: 2027,
      month: 1,
      timezone: DHAKA,
    });
  });

  it('is a no-op at zero and reversible', () => {
    const p = { year: 2026, month: 8, timezone: DHAKA };
    expect(shiftPeriod(p, 0)).toEqual(p);
    expect(shiftPeriod(shiftPeriod(p, -5), 5)).toEqual(p);
  });

  it('CARRIES the zone, so the shifted period resolves against the same calendar', () => {
    const shifted = shiftPeriod({ year: 2026, month: 8, timezone: DHAKA }, -2);
    // Asia/Dhaka is UTC+6 — June starts at 18:00 UTC on 31 May, not 00:00 on 1 June.
    // A shift that dropped the zone would resolve to the UTC month here.
    expect(resolvePeriod(shifted).start.toISOString()).toBe('2026-05-31T18:00:00.000Z');
  });

  it('shifts quarters and years by their own unit', () => {
    expect(shiftPeriod({ year: 2026, quarter: 1, timezone: DHAKA }, -1)).toEqual({
      year: 2025,
      quarter: 4,
      timezone: DHAKA,
    });
    expect(shiftPeriod({ year: 2026, timezone: DHAKA }, 3)).toEqual({ year: 2029, timezone: DHAKA });
  });

  it('REFUSES an ad-hoc period — there is no unit to shift', () => {
    expect(() =>
      shiftPeriod({ year: 2026, start: new Date('2026-01-01'), end: new Date('2026-02-01') }, 1),
    ).toThrow(PeriodError);
  });

  it('refuses a non-integer offset rather than truncating it', () => {
    expect(() => shiftPeriod({ year: 2026, month: 3, timezone: DHAKA }, 1.5)).toThrow(PeriodError);
  });
});
