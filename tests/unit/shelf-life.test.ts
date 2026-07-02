import { describe, expect, it } from 'vitest';
import {
  deriveShelfLifeDates,
  isExpiryTracked,
  isTracked,
  type ShelfLifeError,
  type ShelfLifePolicy,
  shelfLifeStatus,
  validateShelfLifePolicy,
} from '../../src/scheduling/shelf-life.js';

const iso = (s: string) => new Date(s);
const DAY = 24 * 60 * 60 * 1000;

const perishable = (over: Partial<ShelfLifePolicy> = {}): ShelfLifePolicy => ({
  mode: 'lot',
  useExpiration: true,
  shelfLifeDays: 30,
  removalDays: 5,
  alertDays: 10,
  bestBeforeDays: 2,
  ...over,
});

describe('validateShelfLifePolicy', () => {
  it('rejects an unknown mode', () => {
    try {
      validateShelfLifePolicy({ mode: 'batch' as never, useExpiration: false });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ShelfLifeError).code).toBe('INVALID_MODE');
    }
  });

  it('rejects negative / non-finite day offsets', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        validateShelfLifePolicy(perishable({ removalDays: bad }));
        expect.fail(`should throw for removalDays=${bad}`);
      } catch (e) {
        expect((e as ShelfLifeError).code).toBe('INVALID_DAYS');
      }
    }
  });

  it('accepts a minimal none-tracked policy', () => {
    expect(() => validateShelfLifePolicy({ mode: 'none', useExpiration: false })).not.toThrow();
  });
});

describe('isTracked / isExpiryTracked', () => {
  it('mode none is neither tracked nor expiry-tracked', () => {
    const p: ShelfLifePolicy = { mode: 'none', useExpiration: true };
    expect(isTracked(p)).toBe(false);
    expect(isExpiryTracked(p)).toBe(false);
  });

  it('lot without useExpiration is tracked but not expiry-tracked', () => {
    const p: ShelfLifePolicy = { mode: 'lot', useExpiration: false };
    expect(isTracked(p)).toBe(true);
    expect(isExpiryTracked(p)).toBe(false);
  });

  it('serial with useExpiration is both', () => {
    const p: ShelfLifePolicy = { mode: 'serial', useExpiration: true, shelfLifeDays: 1 };
    expect(isExpiryTracked(p)).toBe(true);
  });
});

describe('deriveShelfLifeDates', () => {
  const received = iso('2026-01-01T00:00:00Z');

  it('derives all four dates from shelf life + offsets (Odoo semantics)', () => {
    const dates = deriveShelfLifeDates(received, perishable());
    expect(dates.expiresAt?.getTime()).toBe(received.getTime() + 30 * DAY);
    // each offset is days BEFORE expiration
    expect(dates.bestBeforeDate?.getTime()).toBe(dates.expiresAt!.getTime() - 2 * DAY);
    expect(dates.removalDate?.getTime()).toBe(dates.expiresAt!.getTime() - 5 * DAY);
    expect(dates.alertDate?.getTime()).toBe(dates.expiresAt!.getTime() - 10 * DAY);
  });

  it('returns {} when expiry is not tracked', () => {
    expect(deriveShelfLifeDates(received, { mode: 'lot', useExpiration: false })).toEqual({});
    expect(deriveShelfLifeDates(received, { mode: 'none', useExpiration: true })).toEqual({});
  });

  it('returns {} when expiry-tracked but no shelfLifeDays and no override', () => {
    expect(deriveShelfLifeDates(received, { mode: 'lot', useExpiration: true })).toEqual({});
  });

  it('explicit expiresAt override wins over shelfLifeDays', () => {
    const override = iso('2026-03-01T00:00:00Z');
    const dates = deriveShelfLifeDates(received, perishable(), { expiresAt: override });
    expect(dates.expiresAt?.getTime()).toBe(override.getTime());
    expect(dates.removalDate?.getTime()).toBe(override.getTime() - 5 * DAY);
  });

  it('derives dates from a manual expiry even with no shelfLifeDays', () => {
    const override = iso('2026-02-01T00:00:00Z');
    const policy: ShelfLifePolicy = { mode: 'lot', useExpiration: true, removalDays: 3 };
    const dates = deriveShelfLifeDates(received, policy, { expiresAt: override });
    expect(dates.expiresAt?.getTime()).toBe(override.getTime());
    expect(dates.removalDate?.getTime()).toBe(override.getTime() - 3 * DAY);
  });

  it('only emits sub-dates whose offset is present', () => {
    const dates = deriveShelfLifeDates(received, {
      mode: 'lot',
      useExpiration: true,
      shelfLifeDays: 10,
      removalDays: 2,
    });
    expect(dates.removalDate).toBeDefined();
    expect(dates.alertDate).toBeUndefined();
    expect(dates.bestBeforeDate).toBeUndefined();
  });

  it('clamps an over-long offset to receivedAt (never before receipt)', () => {
    // removalDays (40) exceeds shelf life (30) — removal would land pre-receipt.
    const dates = deriveShelfLifeDates(
      received,
      perishable({ shelfLifeDays: 30, removalDays: 40 }),
    );
    expect(dates.removalDate?.getTime()).toBe(received.getTime());
  });

  it('throws on an invalid receivedAt', () => {
    try {
      deriveShelfLifeDates(new Date('nope'), perishable());
      expect.fail('should throw');
    } catch (e) {
      expect((e as ShelfLifeError).code).toBe('INVALID_RECEIVED_AT');
    }
  });
});

describe('shelfLifeStatus', () => {
  const received = iso('2026-01-01T00:00:00Z');
  const dates = deriveShelfLifeDates(received, perishable()); // exp +30, removal +25, alert +20

  it('fresh before any threshold', () => {
    expect(shelfLifeStatus(dates, iso('2026-01-10T00:00:00Z'))).toBe('fresh');
  });

  it('alert once past alert date', () => {
    expect(shelfLifeStatus(dates, iso('2026-01-22T00:00:00Z'))).toBe('alert');
  });

  it('removed once past removal date but before expiry', () => {
    expect(shelfLifeStatus(dates, iso('2026-01-27T00:00:00Z'))).toBe('removed');
  });

  it('expired once past expiration', () => {
    expect(shelfLifeStatus(dates, iso('2026-02-05T00:00:00Z'))).toBe('expired');
  });

  it('none when no dates apply', () => {
    expect(shelfLifeStatus({}, received)).toBe('none');
  });
});
