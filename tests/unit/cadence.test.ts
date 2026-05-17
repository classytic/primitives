import { describe, expect, it } from 'vitest';
import {
  type Cadence,
  type CadenceError,
  nextOccurrence,
  occurrencesBetween,
  validateCadence,
} from '../../src/scheduling/cadence.js';

const iso = (s: string) => new Date(s);

describe('validateCadence', () => {
  it('rejects non-positive-integer interval', () => {
    const base = { startAt: iso('2026-01-01T00:00:00Z') };
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      try {
        validateCadence({ kind: 'daily', interval: bad, ...base });
        expect.fail(`should throw for interval=${bad}`);
      } catch (e) {
        expect((e as CadenceError).code).toBe('INVALID_INTERVAL');
      }
    }
  });

  it('rejects invalid startAt / endAt', () => {
    try {
      validateCadence({
        kind: 'daily',
        interval: 1,
        startAt: new Date('not-a-date'),
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as CadenceError).code).toBe('INVALID_START_AT');
    }
    try {
      validateCadence({
        kind: 'daily',
        interval: 1,
        startAt: iso('2026-01-01T00:00:00Z'),
        endAt: iso('2025-01-01T00:00:00Z'),
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as CadenceError).code).toBe('INVALID_END_AT');
    }
  });

  it('rejects invalid weekly.daysOfWeek', () => {
    try {
      validateCadence({
        kind: 'weekly',
        interval: 1,
        startAt: iso('2026-01-01T00:00:00Z'),
        daysOfWeek: [],
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as CadenceError).code).toBe('INVALID_DAYS_OF_WEEK');
    }
    try {
      validateCadence({
        kind: 'weekly',
        interval: 1,
        startAt: iso('2026-01-01T00:00:00Z'),
        daysOfWeek: [0 as unknown as 1],
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as CadenceError).code).toBe('INVALID_DAYS_OF_WEEK');
    }
  });

  it('rejects invalid monthly/yearly day-of-month or month', () => {
    try {
      validateCadence({
        kind: 'monthly',
        interval: 1,
        startAt: iso('2026-01-15T00:00:00Z'),
        dayOfMonth: 32,
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as CadenceError).code).toBe('INVALID_DAY_OF_MONTH');
    }
    try {
      validateCadence({
        kind: 'yearly',
        interval: 1,
        startAt: iso('2026-01-15T00:00:00Z'),
        month: 13,
        dayOfMonth: 1,
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as CadenceError).code).toBe('INVALID_MONTH');
    }
  });
});

describe('nextOccurrence — daily', () => {
  const cadence: Cadence = {
    kind: 'daily',
    interval: 1,
    startAt: iso('2026-01-01T09:00:00Z'),
  };

  it('returns startAt when from is before start', () => {
    expect(nextOccurrence(cadence, iso('2025-12-31T00:00:00Z'))?.toISOString()).toBe(
      '2026-01-01T09:00:00.000Z',
    );
  });

  it('returns next day at the anchor time', () => {
    expect(nextOccurrence(cadence, iso('2026-01-05T10:00:00Z'))?.toISOString()).toBe(
      '2026-01-06T09:00:00.000Z',
    );
  });

  it('handles interval > 1', () => {
    const every3: Cadence = { kind: 'daily', interval: 3, startAt: iso('2026-01-01T00:00:00Z') };
    expect(nextOccurrence(every3, iso('2026-01-02T00:00:00Z'))?.toISOString()).toBe(
      '2026-01-04T00:00:00.000Z',
    );
    expect(nextOccurrence(every3, iso('2026-01-04T00:00:00Z'))?.toISOString()).toBe(
      '2026-01-07T00:00:00.000Z',
    );
  });

  it('returns null when past endAt', () => {
    const withEnd: Cadence = {
      kind: 'daily',
      interval: 1,
      startAt: iso('2026-01-01T00:00:00Z'),
      endAt: iso('2026-01-05T00:00:00Z'),
    };
    expect(nextOccurrence(withEnd, iso('2026-01-10T00:00:00Z'))).toBeNull();
  });
});

describe('nextOccurrence — weekly', () => {
  it('stepping by weekdays aligned to interval', () => {
    // 2026-01-05 is Mon (ISO weekday 1), 2026-01-07 is Wed (3)
    const c: Cadence = {
      kind: 'weekly',
      interval: 1,
      startAt: iso('2026-01-05T09:00:00Z'),
      daysOfWeek: [1, 3, 5],
    };
    expect(nextOccurrence(c, iso('2026-01-05T09:00:00Z'))?.toISOString()).toBe(
      '2026-01-07T09:00:00.000Z',
    ); // Mon → Wed
    expect(nextOccurrence(c, iso('2026-01-07T09:00:00Z'))?.toISOString()).toBe(
      '2026-01-09T09:00:00.000Z',
    ); // Wed → Fri
    expect(nextOccurrence(c, iso('2026-01-09T09:00:00Z'))?.toISOString()).toBe(
      '2026-01-12T09:00:00.000Z',
    ); // Fri → Mon (next week)
  });

  it('every 2 weeks skips alternate weeks', () => {
    const c: Cadence = {
      kind: 'weekly',
      interval: 2,
      startAt: iso('2026-01-05T00:00:00Z'), // Mon
    };
    expect(nextOccurrence(c, iso('2026-01-05T00:00:00Z'))?.toISOString()).toBe(
      '2026-01-19T00:00:00.000Z',
    );
  });
});

describe('nextOccurrence — monthly', () => {
  const c: Cadence = {
    kind: 'monthly',
    interval: 1,
    startAt: iso('2026-01-15T09:00:00Z'),
    dayOfMonth: 15,
  };

  it('steps to next month same day', () => {
    expect(nextOccurrence(c, iso('2026-01-15T09:00:00Z'))?.toISOString()).toBe(
      '2026-02-15T09:00:00.000Z',
    );
    expect(nextOccurrence(c, iso('2026-02-20T00:00:00Z'))?.toISOString()).toBe(
      '2026-03-15T09:00:00.000Z',
    );
  });

  it('snaps day-31 to last day of shorter month', () => {
    const c31: Cadence = {
      kind: 'monthly',
      interval: 1,
      startAt: iso('2026-01-31T00:00:00Z'),
      dayOfMonth: 31,
    };
    // Feb 2026 has 28 days
    expect(nextOccurrence(c31, iso('2026-01-31T00:00:00Z'))?.toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('handles interval = 3 (quarterly)', () => {
    const q: Cadence = {
      kind: 'monthly',
      interval: 3,
      startAt: iso('2026-01-01T00:00:00Z'),
      dayOfMonth: 1,
    };
    expect(nextOccurrence(q, iso('2026-01-01T00:00:00Z'))?.toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    );
    expect(nextOccurrence(q, iso('2026-04-01T00:00:00Z'))?.toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
  });
});

describe('nextOccurrence — yearly', () => {
  it('steps to next year same month/day', () => {
    const c: Cadence = {
      kind: 'yearly',
      interval: 1,
      startAt: iso('2026-03-15T00:00:00Z'),
      month: 3,
      dayOfMonth: 15,
    };
    expect(nextOccurrence(c, iso('2026-03-15T00:00:00Z'))?.toISOString()).toBe(
      '2027-03-15T00:00:00.000Z',
    );
  });

  it('Feb 29 snaps to Feb 28 in non-leap years', () => {
    const leapDay: Cadence = {
      kind: 'yearly',
      interval: 1,
      startAt: iso('2024-02-29T00:00:00Z'), // 2024 is leap
      month: 2,
      dayOfMonth: 29,
    };
    expect(nextOccurrence(leapDay, iso('2024-02-29T00:00:00Z'))?.toISOString()).toBe(
      '2025-02-28T00:00:00.000Z',
    );
    expect(nextOccurrence(leapDay, iso('2027-01-01T00:00:00Z'))?.toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    );
  });
});

describe('cron cadence — host-parsed', () => {
  it('returns null from nextOccurrence (host must parse)', () => {
    const c: Cadence = {
      kind: 'cron',
      interval: 1,
      expression: '0 0 * * 1',
      startAt: iso('2026-01-01T00:00:00Z'),
    };
    expect(nextOccurrence(c, iso('2026-01-05T00:00:00Z'))).toBeNull();
  });

  it('returns empty from occurrencesBetween', () => {
    const c: Cadence = {
      kind: 'cron',
      interval: 1,
      expression: '0 0 * * 1',
      startAt: iso('2026-01-01T00:00:00Z'),
    };
    expect(occurrencesBetween(c, iso('2026-01-01T00:00:00Z'), iso('2026-02-01T00:00:00Z'))).toEqual(
      [],
    );
  });
});

describe('occurrencesBetween', () => {
  it('enumerates daily occurrences in range', () => {
    const c: Cadence = {
      kind: 'daily',
      interval: 1,
      startAt: iso('2026-01-01T00:00:00Z'),
    };
    const result = occurrencesBetween(c, iso('2026-01-01T00:00:00Z'), iso('2026-01-05T00:00:00Z'));
    expect(result.map((d) => d.toISOString())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
    ]);
  });

  it('respects the limit parameter', () => {
    const c: Cadence = {
      kind: 'daily',
      interval: 1,
      startAt: iso('2026-01-01T00:00:00Z'),
    };
    const result = occurrencesBetween(
      c,
      iso('2026-01-01T00:00:00Z'),
      iso('2030-01-01T00:00:00Z'),
      3,
    );
    expect(result).toHaveLength(3);
  });

  it('skips entries before `from`', () => {
    const c: Cadence = {
      kind: 'monthly',
      interval: 1,
      startAt: iso('2026-01-15T00:00:00Z'),
      dayOfMonth: 15,
    };
    const result = occurrencesBetween(c, iso('2026-03-01T00:00:00Z'), iso('2026-06-01T00:00:00Z'));
    expect(result.map((d) => d.toISOString())).toEqual([
      '2026-03-15T00:00:00.000Z',
      '2026-04-15T00:00:00.000Z',
      '2026-05-15T00:00:00.000Z',
    ]);
  });
});

describe('determinism', () => {
  it('identical inputs → identical outputs', () => {
    const c: Cadence = {
      kind: 'monthly',
      interval: 1,
      startAt: iso('2026-01-15T09:00:00Z'),
      dayOfMonth: 15,
    };
    const a = nextOccurrence(c, iso('2026-02-01T00:00:00Z'));
    const b = nextOccurrence(c, iso('2026-02-01T00:00:00Z'));
    expect(a?.toISOString()).toBe(b?.toISOString());
  });
});
