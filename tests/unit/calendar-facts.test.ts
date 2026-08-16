/**
 * Calendar facts — the coverage contract and the three-state lookup.
 *
 * The property under test is not "does it find holidays". It is: **can absent data ever read as a
 * negative answer?** Every assertion below exists to keep `unknown` distinguishable from `not-listed`,
 * because a consumer that conflates them turns a half-entered dataset into a confident wrong verdict.
 */
import { describe, expect, it } from 'vitest';
import { civilDate } from '../../src/scheduling/timezone.js';
import {
  defineDateEdition,
  defineDateFactCalendar,
  InvalidDateEditionError,
  InvalidDateFactCalendarError,
  lookupDateFact,
  lookupDateFactAt,
  type PublicHolidayEntry,
} from '../../src/scheduling/calendar-facts.js';

const AUTHORITY = { issuer: 'Ministry of Public Administration', reference: 'Gazette 2026/HOL/01' };

const edition2026 = (
  dates: readonly { date: string; entry: PublicHolidayEntry }[],
  over: Partial<Parameters<typeof defineDateEdition<PublicHolidayEntry>>[0]> = {},
) =>
  defineDateEdition<PublicHolidayEntry>({
    year: '2026',
    coverage: { from: '2026-01-01', through: '2026-12-31' },
    authority: AUTHORITY,
    dates,
    ...over,
  });

const calendar = (dates: readonly { date: string; entry: PublicHolidayEntry }[] = []) =>
  defineDateFactCalendar<PublicHolidayEntry>({
    timeZone: 'Asia/Dhaka',
    editions: { '2026': edition2026(dates) },
  });

describe('lookupDateFact — the three states', () => {
  it('LISTED returns the entry', () => {
    const cal = calendar([{ date: '2026-02-21', entry: { label: 'Shahid Dibosh' } }]);
    expect(lookupDateFact(cal, civilDate('2026-02-21'))).toEqual({
      kind: 'listed',
      entry: { label: 'Shahid Dibosh' },
    });
  });

  it('NOT-LISTED inside coverage — an answer, because the set is complete here', () => {
    const cal = calendar([{ date: '2026-02-21', entry: { label: 'Shahid Dibosh' } }]);
    expect(lookupDateFact(cal, civilDate('2026-02-22'))).toEqual({ kind: 'not-listed' });
  });

  it('a year nobody entered is UNKNOWN, never not-listed', () => {
    /**
     * The core failure this module prevents. A 2029 date checked against a 2026 calendar must not read
     * as an ordinary working day — nobody has said anything about 2029.
     */
    const cal = calendar();
    expect(lookupDateFact(cal, civilDate('2029-04-01'))).toEqual({
      kind: 'unknown',
      reason: 'missing-edition',
    });
  });

  it('a date outside a PRESENT edition\'s coverage is UNKNOWN', () => {
    // The plan's named falsification: move `coverage.through` before the queried date.
    const partial = defineDateEdition<PublicHolidayEntry>({
      year: '2026',
      coverage: { from: '2026-01-01', through: '2026-06-30' },
      authority: AUTHORITY,
      dates: [],
      allowPartialYear: true,
    });
    const cal = defineDateFactCalendar({ timeZone: 'Asia/Dhaka', editions: { '2026': partial } });

    expect(lookupDateFact(cal, civilDate('2026-06-30'))).toEqual({ kind: 'not-listed' });
    expect(lookupDateFact(cal, civilDate('2026-07-01'))).toEqual({
      kind: 'unknown',
      reason: 'outside-coverage',
    });
  });

  it('resolves the EDITION before membership — order is the guard', () => {
    // Checking membership first would answer `not-listed` for an unentered year, which is the bug.
    const cal = calendar([{ date: '2026-02-21', entry: { label: 'Shahid Dibosh' } }]);
    const missing = lookupDateFact(cal, civilDate('2025-02-21'));
    expect(missing.kind).toBe('unknown');
  });

  it('an EMPTY covered edition is a real answer — nil is not unknown', () => {
    /**
     * A year with genuinely no holidays (or none left after amendment) is complete and empty. That is
     * distinct from unentered, and collapsing the two in either direction is wrong.
     */
    const cal = calendar([]);
    expect(lookupDateFact(cal, civilDate('2026-05-01'))).toEqual({ kind: 'not-listed' });
  });

  it('never produces `unattested` — that is the storage layer\'s to report', () => {
    // The reason exists in the union so a config layer can use the same shape. A pure function cannot
    // observe who vouched for the data, so it must not claim to.
    const cal = calendar([{ date: '2026-02-21', entry: { label: 'x' } }]);
    for (const d of ['2026-02-21', '2026-02-22', '2030-01-01']) {
      const r = lookupDateFact(cal, civilDate(d));
      if (r.kind === 'unknown') expect(r.reason).not.toBe('unattested');
    }
  });
});

describe('lookupDateFactAt — the zone belongs to the CALENDAR', () => {
  it('resolves the instant in the calendar zone, not UTC', () => {
    /**
     * 2026-02-21T18:30:00Z is already 2026-02-22 in Asia/Dhaka (UTC+6). A caller converting in UTC
     * would look up the 21st and find the holiday; the business day is the 22nd and has none. This is
     * the six-hour boundary error that once reported August revenue as July.
     */
    const cal = calendar([{ date: '2026-02-21', entry: { label: 'Shahid Dibosh' } }]);

    expect(lookupDateFactAt(cal, new Date('2026-02-21T17:00:00.000Z')).kind).toBe('listed');
    expect(lookupDateFactAt(cal, new Date('2026-02-21T18:30:00.000Z'))).toEqual({ kind: 'not-listed' });
  });
});

describe('defineDateEdition — refuses rather than repairs', () => {
  const problemsOf = (fn: () => unknown): readonly string[] => {
    try {
      fn();
    } catch (err) {
      if (err instanceof InvalidDateEditionError) return err.problems;
      throw err;
    }
    throw new Error('expected InvalidDateEditionError');
  };

  it('reports EVERY problem, not the first', () => {
    // An operator fixing an imported year wants the whole list; one-at-a-time turns one correction
    // into twenty round trips.
    const problems = problemsOf(() =>
      defineDateEdition<PublicHolidayEntry>({
        year: '26',
        coverage: { from: 'nope', through: '2026-12-31' },
        authority: { issuer: '', reference: '' },
        dates: [{ date: 'bad', entry: { label: 'x' } }],
      }),
    );
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });

  it('REFUSES a duplicated date instead of last-write-wins', () => {
    const problems = problemsOf(() =>
      edition2026([
        { date: '2026-02-21', entry: { label: 'Shahid Dibosh' } },
        { date: '2026-02-21', entry: { label: 'Something else' } },
      ]),
    );
    expect(problems.join(' ')).toMatch(/repeats 2026-02-21/);
  });

  it('REFUSES a date outside its own coverage', () => {
    const problems = problemsOf(() => edition2026([{ date: '2027-01-01', entry: { label: 'x' } }]));
    expect(problems.join(' ')).toMatch(/outside the declared coverage/);
  });

  it('REFUSES an edition filed under the wrong year', () => {
    // Otherwise every lookup in that year reports `missing-edition` while the data sits one key away.
    const problems = problemsOf(() =>
      defineDateEdition<PublicHolidayEntry>({
        year: '2027',
        coverage: { from: '2026-01-01', through: '2026-12-31' },
        authority: AUTHORITY,
        dates: [],
      }),
    );
    expect(problems.join(' ')).toMatch(/disagrees with its coverage/);
  });

  it('REFUSES partial-year coverage unless it is opted into', () => {
    const problems = problemsOf(() =>
      defineDateEdition<PublicHolidayEntry>({
        year: '2026',
        coverage: { from: '2026-01-01', through: '2026-06-30' },
        authority: AUTHORITY,
        dates: [],
      }),
    );
    expect(problems.join(' ')).toMatch(/narrower than the full year/);

    // …and accepts it when declared, because a consumer may genuinely have a partial window.
    expect(() =>
      defineDateEdition<PublicHolidayEntry>({
        year: '2026',
        coverage: { from: '2026-01-01', through: '2026-06-30' },
        authority: AUTHORITY,
        dates: [],
        allowPartialYear: true,
      }),
    ).not.toThrow();
  });

  it('REFUSES an unattributed dataset', () => {
    // An anonymous list cannot support a statutory claim; there is nothing to cite in an audit.
    const problems = problemsOf(() =>
      defineDateEdition<PublicHolidayEntry>({
        year: '2026',
        coverage: { from: '2026-01-01', through: '2026-12-31' },
        authority: { issuer: '  ', reference: '' },
        dates: [],
      }),
    );
    expect(problems.join(' ')).toMatch(/authority\.issuer/);
    expect(problems.join(' ')).toMatch(/authority\.reference/);
  });

  it('REFUSES inverted coverage', () => {
    const problems = problemsOf(() =>
      defineDateEdition<PublicHolidayEntry>({
        year: '2026',
        coverage: { from: '2026-12-31', through: '2026-01-01' },
        authority: AUTHORITY,
        dates: [],
        allowPartialYear: true,
      }),
    );
    expect(problems.join(' ')).toMatch(/is after coverage\.through/);
  });
});

describe('defineDateFactCalendar — the timezone is checked, not trusted', () => {
  it('REFUSES an unrecognised zone', () => {
    /**
     * A wrong zone is worse than a missing one: it shifts every boundary by the offset while every
     * value still looks like a valid date.
     */
    expect(() =>
      defineDateFactCalendar<PublicHolidayEntry>({
        timeZone: 'Asia/Daka',
        editions: { '2026': edition2026([]) },
      }),
    ).toThrow(InvalidDateFactCalendarError);
  });

  it('REFUSES a missing zone', () => {
    expect(() =>
      defineDateFactCalendar<PublicHolidayEntry>({ timeZone: '', editions: {} }),
    ).toThrow(/timeZone is required/);
  });

  it('REFUSES an edition filed under a mismatched key', () => {
    // The edition itself is valid; the CALENDAR files it wrongly. Both must be caught.
    const valid = edition2026([]);
    expect(() =>
      defineDateFactCalendar<PublicHolidayEntry>({
        timeZone: 'Asia/Dhaka',
        editions: { '2027': valid },
      }),
    ).toThrow(/filed under a year its coverage/);
  });

  it('accepts a well-formed calendar', () => {
    expect(calendar([{ date: '2026-12-16', entry: { label: 'Victory Day' } }]).timeZone).toBe('Asia/Dhaka');
  });
});
