import { describe, expect, it } from 'vitest';
import { startOfMonth } from '../../src/scheduling/calendar.js';
import {
  addCivilDays,
  civilDate,
  civilDateOf,
  civilDateToInstant,
  civilDaysBetween,
  isCivilDate,
  isValidTimeZone,
  listTimeZones,
  localTimeParts,
  TimeZoneError,
  zoneOffsetLabel,
  zoneOffsetMinutes,
} from '../../src/scheduling/timezone.js';

const iso = (d: Date) => d.toISOString();

describe('zoneOffsetMinutes (per-instant, DST-exact)', () => {
  it('fixed-offset zones: Dhaka is +360 year-round', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Asia/Dhaka')).toBe(360);
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Asia/Dhaka')).toBe(360);
  });

  it('half-hour zones: Kolkata is +330', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-02T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('DST zones flip with the instant: London 0 in winter, +60 in summer', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Europe/London')).toBe(0);
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/London')).toBe(60);
  });

  it('negative offsets: New York -300 (EST) / -240 (EDT)', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240);
  });

  it('UTC is 0 and composes with /calendar boundaries', () => {
    const instant = new Date('2026-07-02T03:00:00Z'); // 09:00 Dhaka
    expect(zoneOffsetMinutes(instant, 'UTC')).toBe(0);
    // The documented composition: IANA name → offset → calendar math.
    const dhakaMonthStart = startOfMonth(instant, zoneOffsetMinutes(instant, 'Asia/Dhaka'));
    expect(iso(dhakaMonthStart)).toBe('2026-06-30T18:00:00.000Z'); // July 1 00:00 Dhaka
  });

  it('throws TimeZoneError on garbage zones', () => {
    expect(() => zoneOffsetMinutes(new Date(), 'Not/AZone')).toThrowError(TimeZoneError);
  });
});

describe('zoneOffsetLabel', () => {
  it('renders picker-ready labels', () => {
    expect(zoneOffsetLabel(new Date('2026-07-02T00:00:00Z'), 'Asia/Dhaka')).toBe('GMT+06:00');
    expect(zoneOffsetLabel(new Date('2026-07-02T00:00:00Z'), 'Asia/Kolkata')).toBe('GMT+05:30');
  });
});

describe('localTimeParts (wall clock in zone)', () => {
  it('resolves weekday + time in the zone, not the server TZ', () => {
    // 2026-07-02 is a Thursday. 20:30Z = 02:30 Friday in Dhaka.
    const parts = localTimeParts(new Date('2026-07-02T20:30:00Z'), 'Asia/Dhaka');
    expect(parts.isoWeekday).toBe(5); // Friday
    expect(parts.hour).toBe(2);
    expect(parts.minute).toBe(30);
    expect(parts.minutesOfDay).toBe(150);
  });

  it('normalizes ICU midnight-as-24 to hour 0', () => {
    // 18:00Z = exactly 00:00 Dhaka.
    const parts = localTimeParts(new Date('2026-07-02T18:00:00Z'), 'Asia/Dhaka');
    expect(parts.hour).toBe(0);
    expect(parts.minutesOfDay).toBe(0);
  });
});

describe('CivilDate', () => {
  it('validates real calendar days', () => {
    expect(isCivilDate('2026-07-02')).toBe(true);
    expect(isCivilDate('2026-02-29')).toBe(false); // 2026 not a leap year
    expect(isCivilDate('2024-02-29')).toBe(true);
    expect(isCivilDate('2026-13-01')).toBe(false);
    expect(isCivilDate('2026-7-2')).toBe(false);
    expect(() => civilDate('garbage')).toThrowError(TimeZoneError);
  });

  it('civilDateOf: the business date follows the zone, never the server', () => {
    // 20:30Z on the 2nd is already the 3rd in Dhaka — POS business date.
    expect(civilDateOf(new Date('2026-07-02T20:30:00Z'), 'Asia/Dhaka')).toBe('2026-07-03');
    expect(civilDateOf(new Date('2026-07-02T20:30:00Z'), 'UTC')).toBe('2026-07-02');
    // ...and 02:00Z on the 2nd is still the 1st in New York.
    expect(civilDateOf(new Date('2026-07-02T02:00:00Z'), 'America/New_York')).toBe('2026-07-01');
  });

  it('civilDateToInstant: local midnight / wall time → exact instant', () => {
    const night = civilDate('2026-07-03');
    expect(iso(civilDateToInstant(night, 'Asia/Dhaka'))).toBe('2026-07-02T18:00:00.000Z');
    // Hotel check-in 14:00 local:
    expect(iso(civilDateToInstant(night, 'Asia/Dhaka', { hour: 14 }))).toBe(
      '2026-07-03T08:00:00.000Z',
    );
  });

  it('round-trips across a DST boundary (two-pass offset)', () => {
    // US spring-forward 2026: March 8, 02:00 → 03:00 in America/New_York.
    const dstDay = civilDate('2026-03-08');
    const midnight = civilDateToInstant(dstDay, 'America/New_York');
    expect(iso(midnight)).toBe('2026-03-08T05:00:00.000Z'); // EST midnight
    expect(civilDateOf(midnight, 'America/New_York')).toBe('2026-03-08');
    // A wall time INSIDE the spring-forward gap resolves to the shifted
    // instant (Temporal 'compatible' semantics) and stays on the same day.
    const gap = civilDateToInstant(dstDay, 'America/New_York', { hour: 2, minute: 30 });
    expect(civilDateOf(gap, 'America/New_York')).toBe('2026-03-08');
  });

  it('addCivilDays + civilDaysBetween: pure night math', () => {
    expect(addCivilDays(civilDate('2026-02-28'), 1)).toBe('2026-03-01');
    expect(addCivilDays(civilDate('2026-01-01'), -1)).toBe('2025-12-31');
    // 3-night stay: [Jan 1, Jan 4)
    expect(civilDaysBetween(civilDate('2026-01-01'), civilDate('2026-01-04'))).toBe(3);
    expect(civilDaysBetween(civilDate('2026-01-04'), civilDate('2026-01-01'))).toBe(-3);
  });
});

describe('zone validation + enumeration', () => {
  it('isValidTimeZone accepts IANA names, rejects junk', () => {
    expect(isValidTimeZone('Asia/Dhaka')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Dhaka')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('listTimeZones returns the ICU universe (picker data source)', () => {
    const zones = listTimeZones();
    expect(zones.length).toBeGreaterThan(300);
    expect(zones).toContain('Asia/Dhaka');
    expect(zones).toContain('Europe/London');
    expect(listTimeZones()).toBe(zones); // cached
  });
});
