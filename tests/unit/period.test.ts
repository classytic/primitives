import { describe, expect, it } from 'vitest';
import {
  isDateRange,
  isWithin,
  rangeDurationMs,
  rangesOverlap,
} from '../../src/scheduling/period.js';
import { makeDateRange } from '../helpers/fixtures.js';

describe('isDateRange', () => {
  it('accepts valid Date endpoints', () => {
    expect(isDateRange(makeDateRange())).toBe(true);
    expect(isDateRange({ start: new Date(), end: new Date() })).toBe(true);
  });

  it('rejects non-Date endpoints', () => {
    expect(isDateRange({ start: '2026-01-01', end: '2026-12-31' })).toBe(false);
    expect(isDateRange({ start: 1735689600000, end: 1767225599000 })).toBe(false);
    expect(isDateRange({})).toBe(false);
  });

  it('rejects nullish / primitives', () => {
    expect(isDateRange(null)).toBe(false);
    expect(isDateRange(undefined)).toBe(false);
    expect(isDateRange('2026')).toBe(false);
  });
});

describe('isWithin', () => {
  const range = makeDateRange({
    start: new Date('2026-01-01T00:00:00Z'),
    end: new Date('2026-12-31T23:59:59Z'),
  });

  it('accepts dates inside the range', () => {
    expect(isWithin(new Date('2026-06-15'), range)).toBe(true);
  });

  it('is inclusive on both endpoints', () => {
    expect(isWithin(range.start, range)).toBe(true);
    expect(isWithin(range.end, range)).toBe(true);
  });

  it('rejects dates outside the range', () => {
    expect(isWithin(new Date('2025-12-31'), range)).toBe(false);
    expect(isWithin(new Date('2027-01-01'), range)).toBe(false);
  });
});

describe('rangeDurationMs', () => {
  it('computes duration in ms', () => {
    const range = {
      start: new Date('2026-01-01T00:00:00Z'),
      end: new Date('2026-01-01T00:00:01Z'),
    };
    expect(rangeDurationMs(range)).toBe(1000);
  });

  it('returns 0 for instantaneous range', () => {
    const now = new Date();
    expect(rangeDurationMs({ start: now, end: now })).toBe(0);
  });

  it('returns negative when end precedes start', () => {
    expect(
      rangeDurationMs({
        start: new Date('2026-01-02'),
        end: new Date('2026-01-01'),
      }),
    ).toBeLessThan(0);
  });
});

describe('rangesOverlap', () => {
  const r = (s: string, e: string) => ({ start: new Date(s), end: new Date(e) });

  it('detects overlap when ranges intersect', () => {
    expect(
      rangesOverlap(
        r('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
        r('2026-05-01T10:30:00Z', '2026-05-01T11:30:00Z'),
      ),
    ).toBe(true);
  });

  it('returns false for adjacent (back-to-back) ranges — half-open semantics', () => {
    // 10:00-11:00 and 11:00-12:00 do NOT overlap — end is exclusive.
    expect(
      rangesOverlap(
        r('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
        r('2026-05-01T11:00:00Z', '2026-05-01T12:00:00Z'),
      ),
    ).toBe(false);
  });

  it('detects full containment', () => {
    expect(
      rangesOverlap(
        r('2026-05-01T08:00:00Z', '2026-05-01T18:00:00Z'),
        r('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
      ),
    ).toBe(true);
  });

  it('is symmetric', () => {
    const a = r('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z');
    const b = r('2026-05-01T10:30:00Z', '2026-05-01T11:30:00Z');
    expect(rangesOverlap(a, b)).toBe(rangesOverlap(b, a));
  });

  it('returns false for completely disjoint ranges', () => {
    expect(
      rangesOverlap(
        r('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
        r('2026-05-02T10:00:00Z', '2026-05-02T11:00:00Z'),
      ),
    ).toBe(false);
  });
});
