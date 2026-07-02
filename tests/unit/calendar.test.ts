import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  isoWeekday,
  startOfDay,
  startOfMonth,
} from '../../src/scheduling/calendar.js';

const iso = (d: Date) => d.toISOString();

describe('calendar boundaries (offset-based, no server-local, no DST)', () => {
  it('startOfDay: UTC (offset 0) truncates to UTC midnight', () => {
    expect(iso(startOfDay(new Date('2026-07-02T15:30:00Z')))).toBe('2026-07-02T00:00:00.000Z');
  });

  it('startOfDay: UTC+6 (Dhaka) uses LOCAL midnight, independent of server TZ', () => {
    // 03:00 UTC = 09:00 Dhaka → local day is the 2nd; Dhaka midnight = 1st 18:00 UTC.
    expect(iso(startOfDay(new Date('2026-07-02T03:00:00Z'), 360))).toBe('2026-07-01T18:00:00.000Z');
    // 20:00 UTC = 02:00 Dhaka next day → local day is the 3rd; midnight = 2nd 18:00 UTC.
    expect(iso(startOfDay(new Date('2026-07-02T20:00:00Z'), 360))).toBe('2026-07-02T18:00:00.000Z');
  });

  it('two instants in the same Dhaka day share a startOfDay (window key stability)', () => {
    const a = startOfDay(new Date('2026-07-02T18:30:00Z'), 360); // 00:30 Dhaka 3rd
    const b = startOfDay(new Date('2026-07-03T10:00:00Z'), 360); // 16:00 Dhaka 3rd
    expect(+a).toBe(+b);
  });

  it('startOfMonth respects the offset', () => {
    // 2026-07-01T02:00Z = 08:00 Dhaka 1st → month start = Jun 30 18:00 UTC (Dhaka Jul 1 00:00).
    expect(iso(startOfMonth(new Date('2026-07-01T02:00:00Z'), 360))).toBe(
      '2026-06-30T18:00:00.000Z',
    );
    expect(iso(startOfMonth(new Date('2026-07-15T12:00:00Z')))).toBe('2026-07-01T00:00:00.000Z');
  });

  it('isoWeekday: 1=Mon..7=Sun, offset-aware', () => {
    expect(isoWeekday(new Date('2026-07-02T12:00:00Z'))).toBe(4); // Thu (2026-07-02 is a Thursday)
    // 2026-07-02T20:00Z is Fri 02:00 Dhaka → weekday 5.
    expect(isoWeekday(new Date('2026-07-02T20:00:00Z'), 360)).toBe(5);
  });

  it('addMonths is UTC + clamps month-end (Jan 31 + 1 = Feb 28)', () => {
    expect(iso(addMonths(new Date('2026-01-31T00:00:00Z'), 1))).toBe('2026-02-28T00:00:00.000Z');
    expect(iso(addMonths(new Date('2024-01-31T00:00:00Z'), 1))).toBe('2024-02-29T00:00:00.000Z'); // leap
    expect(iso(addMonths(new Date('2026-07-15T09:00:00Z'), 6))).toBe('2027-01-15T09:00:00.000Z');
  });

  it('addDays is an exact 24h duration; addYears clamps Feb 29', () => {
    expect(iso(addDays(new Date('2026-07-02T00:00:00Z'), 30))).toBe('2026-08-01T00:00:00.000Z');
    expect(iso(addYears(new Date('2024-02-29T00:00:00Z'), 1))).toBe('2025-02-28T00:00:00.000Z');
  });
});
