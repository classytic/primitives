/**
 * `Cadence.timezone` is AUTHORITATIVE — the occurrence math runs on that zone's
 * wall clock.
 *
 * Every assertion here would pass under the old UTC-only math if the zone were
 * UTC, so each is written where the two answers differ: an east-of-UTC zone for
 * the day-boundary cases, and a DST zone for the transition cases.
 */

import { describe, expect, it } from 'vitest';
import {
  type Cadence,
  CadenceError,
  nextOccurrence,
  occurrencesBetween,
  validateCadence,
} from '../../src/scheduling/cadence.js';
import { civilDateOf, localTimeParts } from '../../src/scheduling/timezone.js';

const DHAKA = 'Asia/Dhaka';
const NY = 'America/New_York';
const iso = (d: Date | null) => d?.toISOString();

describe('monthly — the documented "lands on the 2nd" bug', () => {
  // 2026-01-01T00:00 Dhaka.
  const startAt = new Date('2025-12-31T18:00:00.000Z');

  const zoned: Cadence = { kind: 'monthly', interval: 1, dayOfMonth: 1, startAt, timezone: DHAKA };
  const unzoned: Cadence = { kind: 'monthly', interval: 1, dayOfMonth: 1, startAt };

  it('places the occurrence on the local 1st at the local anchor time', () => {
    const next = nextOccurrence(zoned, new Date('2026-02-20T00:00:00Z'));
    expect(iso(next)).toBe('2026-02-28T18:00:00.000Z');
    expect(civilDateOf(next as Date, DHAKA)).toBe('2026-03-01');
    expect(localTimeParts(next as Date, DHAKA)).toMatchObject({ hour: 0, minute: 0 });
  });

  it('the UTC math (no zone) would have placed it on the local SECOND', () => {
    const next = nextOccurrence(unzoned, new Date('2026-02-20T00:00:00Z'));
    expect(iso(next)).toBe('2026-03-01T18:00:00.000Z');
    expect(civilDateOf(next as Date, DHAKA)).toBe('2026-03-02');
  });

  it('every occurrence in a year is the local 1st at local midnight', () => {
    const all = occurrencesBetween(
      zoned,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2027-01-01T00:00:00Z'),
    );
    expect(all.length).toBeGreaterThan(10);
    for (const o of all) {
      expect(civilDateOf(o, DHAKA).slice(8)).toBe('01');
      expect(localTimeParts(o, DHAKA).minutesOfDay).toBe(0);
    }
  });
});

describe('monthly — DST-exact wall time', () => {
  // 2026-01-15T09:00 New York (EST, UTC-5).
  const startAt = new Date('2026-01-15T14:00:00.000Z');
  const c: Cadence = { kind: 'monthly', interval: 1, dayOfMonth: 15, startAt, timezone: NY };

  it('keeps 09:00 LOCAL across the spring-forward boundary (UTC hour shifts, wall time does not)', () => {
    const feb = nextOccurrence(c, new Date('2026-01-20T00:00:00Z'));
    const mar = nextOccurrence(c, new Date('2026-02-20T00:00:00Z'));
    const apr = nextOccurrence(c, new Date('2026-03-20T00:00:00Z'));

    expect(iso(feb)).toBe('2026-02-15T14:00:00.000Z'); // EST
    expect(iso(mar)).toBe('2026-03-15T13:00:00.000Z'); // EDT — one hour earlier in UTC
    expect(iso(apr)).toBe('2026-04-15T13:00:00.000Z');

    for (const o of [feb, mar, apr]) {
      expect(localTimeParts(o as Date, NY)).toMatchObject({ hour: 9, minute: 0 });
    }
  });

  it('preserves seconds from the anchor rather than truncating to the minute', () => {
    const withSeconds: Cadence = {
      kind: 'monthly',
      interval: 1,
      dayOfMonth: 15,
      startAt: new Date('2026-01-15T14:00:17.250Z'),
      timezone: NY,
    };
    const next = nextOccurrence(withSeconds, new Date('2026-01-20T00:00:00Z'));
    expect(iso(next)).toBe('2026-02-15T14:00:17.250Z');
  });

  it('clamps a 31st to the local month end', () => {
    const eom: Cadence = {
      kind: 'monthly',
      interval: 1,
      dayOfMonth: 31,
      startAt: new Date('2026-01-31T18:00:00.000Z'), // 2026-02-01 00:00 Dhaka… anchored below
      timezone: DHAKA,
    };
    const next = nextOccurrence(eom, new Date('2026-02-10T00:00:00Z'));
    expect(civilDateOf(next as Date, DHAKA)).toBe('2026-02-28');
  });
});

describe('yearly', () => {
  const c: Cadence = {
    kind: 'yearly',
    interval: 1,
    month: 1,
    dayOfMonth: 1,
    startAt: new Date('2025-12-31T18:00:00.000Z'), // 2026-01-01 00:00 Dhaka
    timezone: DHAKA,
  };

  it('fires on the local New Year, not the UTC one', () => {
    const next = nextOccurrence(c, new Date('2026-06-01T00:00:00Z'));
    expect(iso(next)).toBe('2026-12-31T18:00:00.000Z');
    expect(civilDateOf(next as Date, DHAKA)).toBe('2027-01-01');
  });

  it('the unzoned form fires a full local day later', () => {
    const unzoned: Cadence = {
      kind: 'yearly',
      interval: 1,
      month: 1,
      dayOfMonth: 1,
      startAt: c.startAt,
    };
    expect(iso(nextOccurrence(unzoned, new Date('2026-06-01T00:00:00Z')))).toBe(
      '2027-01-01T18:00:00.000Z',
    );
  });
});

describe('daily — local days, not flat 24h', () => {
  // 2026-03-07T09:00 New York (EST). The next day is a spring-forward day.
  const c: Cadence = {
    kind: 'daily',
    interval: 1,
    startAt: new Date('2026-03-07T14:00:00.000Z'),
    timezone: NY,
  };

  it('advances 23h across spring-forward so the local time stays 09:00', () => {
    const next = nextOccurrence(c, new Date('2026-03-07T14:00:00.000Z'));
    expect(iso(next)).toBe('2026-03-08T13:00:00.000Z');
    expect((next as Date).getTime() - c.startAt.getTime()).toBe(23 * 3_600_000);
    expect(localTimeParts(next as Date, NY)).toMatchObject({ hour: 9 });
  });

  it('the unzoned form drifts the local time by an hour', () => {
    const unzoned: Cadence = { kind: 'daily', interval: 1, startAt: c.startAt };
    const next = nextOccurrence(unzoned, new Date('2026-03-07T14:00:00.000Z'));
    expect(iso(next)).toBe('2026-03-08T14:00:00.000Z');
    expect(localTimeParts(next as Date, NY).hour).toBe(10); // drifted
  });

  it('honours an interval > 1 in local days', () => {
    const every3: Cadence = { ...c, interval: 3 };
    const all = occurrencesBetween(
      every3,
      new Date('2026-03-07T00:00:00Z'),
      new Date('2026-03-20T00:00:00Z'),
    );
    expect(all.map((d) => civilDateOf(d, NY))).toEqual([
      '2026-03-07',
      '2026-03-10',
      '2026-03-13',
      '2026-03-16',
      '2026-03-19',
    ]);
  });
});

describe('weekly — the LOCAL weekday decides', () => {
  it('fires on the local Friday even when the instant is a UTC Thursday', () => {
    // Anchor: Friday 2026-08-07 01:00 Dhaka === Thursday 2026-08-06 19:00Z.
    const c: Cadence = {
      kind: 'weekly',
      interval: 1,
      daysOfWeek: [5], // Friday
      startAt: new Date('2026-08-06T19:00:00.000Z'),
      timezone: DHAKA,
    };
    const all = occurrencesBetween(
      c,
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(all.length).toBeGreaterThan(2);
    for (const o of all) {
      // Local Friday…
      expect(new Date(`${civilDateOf(o, DHAKA)}T00:00:00Z`).getUTCDay()).toBe(5);
      // …which is a UTC Thursday.
      expect(o.getUTCDay()).toBe(4);
    }
  });

  it('defaults to the anchor’s LOCAL weekday when daysOfWeek is omitted', () => {
    const c: Cadence = {
      kind: 'weekly',
      interval: 1,
      startAt: new Date('2026-08-06T19:00:00.000Z'), // local Friday
      timezone: DHAKA,
    };
    const next = nextOccurrence(c, new Date('2026-08-10T00:00:00Z'));
    expect(civilDateOf(next as Date, DHAKA)).toBe('2026-08-14'); // the next local Friday
  });

  it('advances a LOCAL week across spring-forward, not a flat 7×24h', () => {
    // Anchor: Friday 2026-03-06 09:00 New York (EST). DST starts Sunday 2026-03-08.
    const c: Cadence = {
      kind: 'weekly',
      interval: 1,
      startAt: new Date('2026-03-06T14:00:00.000Z'),
      timezone: NY,
    };
    const next = nextOccurrence(c, new Date('2026-03-06T14:00:00.000Z')) as Date;
    // 09:00 local is preserved, so the UTC instant moves an hour earlier —
    // a flat 7-day add would land on 14:00Z == 10:00 local.
    expect(iso(next)).toBe('2026-03-13T13:00:00.000Z');
    expect(localTimeParts(next, NY)).toMatchObject({ hour: 9, isoWeekday: 5 });
    expect(next.getTime() - c.startAt.getTime()).toBe((7 * 24 - 1) * 3_600_000);
  });
});

describe('validateCadence rejects an unresolvable zone', () => {
  it('throws INVALID_TIMEZONE rather than silently computing in UTC', () => {
    const bad: Cadence = {
      kind: 'monthly',
      interval: 1,
      dayOfMonth: 1,
      startAt: new Date('2026-01-01T00:00:00Z'),
      timezone: 'Asia/Dacca_Typo',
    };
    expect(() => validateCadence(bad)).toThrow(CadenceError);
    expect(() => validateCadence(bad)).toThrow(/valid IANA zone/);
    expect(() => nextOccurrence(bad, new Date())).toThrow(CadenceError);
  });

  it('accepts an absent zone (a locale-free schedule stays UTC)', () => {
    expect(() =>
      validateCadence({ kind: 'daily', interval: 1, startAt: new Date('2026-01-01T00:00:00Z') }),
    ).not.toThrow();
  });
});

describe('a decade-old anchor still lands on the right local day', () => {
  // The zoned steppers jump to the last interval-aligned period at or before
  // `from` instead of walking from the anchor. `floor` must never overshoot —
  // these assert the jump lands on the same answer a naive walk would.
  const startAt = new Date('2015-12-31T18:00:00.000Z'); // 2016-01-01 00:00 Dhaka

  const from = new Date('2026-08-05T00:00:00Z');

  /** Walk every occurrence from the anchor — what the jump must reproduce. */
  const bruteForceNext = (c: Cadence): Date => {
    let cursor = c.startAt;
    for (let i = 0; i < 100_000; i++) {
      if (cursor.getTime() > from.getTime()) return cursor;
      const n = nextOccurrence(c, cursor);
      if (n === null) throw new Error('cadence ended');
      cursor = n;
    }
    throw new Error('did not converge');
  };

  it('monthly, interval 5, anchor 10 years back', () => {
    const c: Cadence = { kind: 'monthly', interval: 5, dayOfMonth: 1, startAt, timezone: DHAKA };
    const next = nextOccurrence(c, from) as Date;
    expect(iso(next)).toBe(iso(bruteForceNext(c)));
    expect(civilDateOf(next, DHAKA)).toBe('2026-11-01');
    expect(localTimeParts(next, DHAKA).minutesOfDay).toBe(0);
    // The occurrence immediately before `from` is not skipped by the jump.
    const prior = occurrencesBetween(c, new Date('2026-01-01T00:00:00Z'), from);
    expect(prior.map((d) => civilDateOf(d, DHAKA))).toEqual(['2026-06-01']);
  });

  it('yearly, interval 3, anchor 10 years back', () => {
    const c: Cadence = {
      kind: 'yearly',
      interval: 3,
      month: 1,
      dayOfMonth: 1,
      startAt,
      timezone: DHAKA,
    };
    const next = nextOccurrence(c, from) as Date;
    expect(iso(next)).toBe(iso(bruteForceNext(c)));
    expect(civilDateOf(next, DHAKA)).toBe('2028-01-01'); // 2016, 2019, 2022, 2025, 2028
    const window = occurrencesBetween(
      c,
      new Date('2024-01-01T00:00:00Z'),
      new Date('2027-01-01T00:00:00Z'),
    );
    expect(window.map((d) => civilDateOf(d, DHAKA))).toEqual(['2025-01-01']);
  });
});

describe('the two arithmetics agree when the zone IS UTC', () => {
  const startAt = new Date('2026-01-15T09:30:00.000Z');
  const from = new Date('2026-04-02T00:00:00Z');

  for (const c of [
    { kind: 'daily', interval: 2 },
    { kind: 'weekly', interval: 1, daysOfWeek: [3] },
    { kind: 'monthly', interval: 1, dayOfMonth: 15 },
    { kind: 'yearly', interval: 1, month: 3, dayOfMonth: 15 },
  ] as const) {
    it(`${c.kind}`, () => {
      const utc = nextOccurrence({ ...c, startAt } as Cadence, from);
      const zoned = nextOccurrence({ ...c, startAt, timezone: 'UTC' } as Cadence, from);
      expect(iso(zoned)).toBe(iso(utc));
    });
  }
});
