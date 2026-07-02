import { describe, expect, it } from 'vitest';
import {
  defineSLAPolicy,
  deriveFirstResponseSLA,
  deriveRollingResponseSLA,
  evaluateSLAStatus,
  isWithinWorkingHours,
  type SLAPolicy,
  SLAPolicyError,
} from '../../src/scheduling/sla-policy.js';

const policy: SLAPolicy = defineSLAPolicy({
  name: 'Lead response',
  priorities: {
    urgent: { firstResponseMs: 30 * 60_000, rollingResponseMs: 60 * 60_000 },
    high: { firstResponseMs: 2 * 3_600_000, rollingResponseMs: 4 * 3_600_000 },
    normal: { firstResponseMs: 8 * 3_600_000, rollingResponseMs: 24 * 3_600_000 },
  },
  defaultPriority: 'normal',
});

describe('defineSLAPolicy', () => {
  it('returns the spec unchanged when valid', () => {
    expect(policy.name).toBe('Lead response');
    expect(policy.defaultPriority).toBe('normal');
  });

  it('rejects empty priorities map', () => {
    expect(() =>
      defineSLAPolicy({
        name: 'X',
        priorities: {},
        defaultPriority: 'normal',
      }),
    ).toThrow(SLAPolicyError);
  });

  it('rejects defaultPriority not present in the priorities map', () => {
    expect(() =>
      defineSLAPolicy({
        name: 'X',
        priorities: { high: { firstResponseMs: 1000, rollingResponseMs: 1000 } },
        defaultPriority: 'normal',
      }),
    ).toThrow(/defaultPriority 'normal' is not present/);
  });

  it('rejects non-positive duration', () => {
    expect(() =>
      defineSLAPolicy({
        name: 'X',
        priorities: { normal: { firstResponseMs: 0, rollingResponseMs: 1000 } },
        defaultPriority: 'normal',
      }),
    ).toThrow(/non-positive duration/);
  });

  it('rejects invalid working-hours bounds', () => {
    expect(() =>
      defineSLAPolicy({
        name: 'X',
        priorities: { normal: { firstResponseMs: 1000, rollingResponseMs: 1000 } },
        defaultPriority: 'normal',
        workingHours: { weekdays: [1], startMinute: 600, endMinute: 300 },
      }),
    ).toThrow(/workingHours bounds are invalid/);
  });
});

describe('deriveFirstResponseSLA / deriveRollingResponseSLA', () => {
  it('uses the explicit priority when given', () => {
    expect(deriveFirstResponseSLA(policy, 'urgent').targetDurationMs).toBe(30 * 60_000);
    expect(deriveRollingResponseSLA(policy, 'urgent').targetDurationMs).toBe(60 * 60_000);
  });

  it('falls back to defaultPriority when omitted', () => {
    expect(deriveFirstResponseSLA(policy).targetDurationMs).toBe(8 * 3_600_000);
  });

  it('falls back to defaultPriority for unknown priorities', () => {
    expect(deriveFirstResponseSLA(policy, 'mythical-key').targetDurationMs).toBe(8 * 3_600_000);
  });
});

describe('evaluateSLAStatus', () => {
  const startedAt = new Date('2026-01-01T10:00:00Z');

  it('FirstResponseDue when no first response yet and within window', () => {
    const now = new Date('2026-01-01T10:05:00Z'); // +5 min (urgent has 30 min)
    const status = evaluateSLAStatus(
      policy,
      { priority: 'urgent', startedAt, firstRespondedAt: null, lastRespondedAt: null },
      now,
    );
    expect(status.kind).toBe('FirstResponseDue');
    expect(status.breached).toBe(false);
    expect(status.remainingMs).toBeGreaterThan(0);
  });

  it('Failed when the first-response window is exceeded', () => {
    const now = new Date('2026-01-01T11:00:00Z'); // +60 min (urgent only allows 30)
    const status = evaluateSLAStatus(
      policy,
      { priority: 'urgent', startedAt, firstRespondedAt: null, lastRespondedAt: null },
      now,
    );
    expect(status.kind).toBe('Failed');
    expect(status.breached).toBe(true);
  });

  it('FirstResponseFulfilled when first response logged and no rolling cycle open', () => {
    const status = evaluateSLAStatus(
      policy,
      {
        priority: 'urgent',
        startedAt,
        firstRespondedAt: new Date('2026-01-01T10:10:00Z'),
        lastRespondedAt: null,
      },
      new Date('2026-01-01T15:00:00Z'),
    );
    expect(status.kind).toBe('FirstResponseFulfilled');
    expect(status.breached).toBe(false);
  });

  it('RollingResponseDue when within the rolling window', () => {
    const status = evaluateSLAStatus(
      policy,
      {
        priority: 'urgent',
        startedAt,
        firstRespondedAt: new Date('2026-01-01T10:10:00Z'),
        lastRespondedAt: new Date('2026-01-01T11:00:00Z'),
      },
      new Date('2026-01-01T11:30:00Z'),
    );
    expect(status.kind).toBe('RollingResponseDue');
    expect(status.breached).toBe(false);
  });

  it('Failed when the rolling window is exceeded', () => {
    const status = evaluateSLAStatus(
      policy,
      {
        priority: 'urgent',
        startedAt,
        firstRespondedAt: new Date('2026-01-01T10:10:00Z'),
        lastRespondedAt: new Date('2026-01-01T11:00:00Z'),
      },
      new Date('2026-01-01T13:00:00Z'), // > rollingResponseMs (60 min) since lastResponded
    );
    expect(status.kind).toBe('Failed');
    expect(status.breached).toBe(true);
  });
});

describe('isWithinWorkingHours', () => {
  const officeHours: SLAPolicy = defineSLAPolicy({
    name: 'office',
    priorities: { normal: { firstResponseMs: 3_600_000, rollingResponseMs: 3_600_000 } },
    defaultPriority: 'normal',
    workingHours: {
      weekdays: [1, 2, 3, 4, 5], // Mon–Fri
      startMinute: 9 * 60, // 09:00 UTC
      endMinute: 18 * 60, // 18:00 UTC
      holidays: ['2026-01-01'],
    },
  });

  it('returns true when no workingHours is set (always-on SLA)', () => {
    expect(isWithinWorkingHours(policy, new Date('2026-01-04T03:00:00Z'))).toBe(true); // Sun 03:00
  });

  it('false outside working hours', () => {
    // Thu (weekday 4), 04:00 UTC — before opening
    expect(isWithinWorkingHours(officeHours, new Date('2026-01-08T04:00:00Z'))).toBe(false);
  });

  it('true inside working hours on a working day', () => {
    // Thu 14:00 UTC
    expect(isWithinWorkingHours(officeHours, new Date('2026-01-08T14:00:00Z'))).toBe(true);
  });

  it('false on weekends', () => {
    // Sat (weekday 6), 14:00 UTC
    expect(isWithinWorkingHours(officeHours, new Date('2026-01-10T14:00:00Z'))).toBe(false);
  });

  it('false on listed holidays', () => {
    // 2026-01-01 is a Thu (weekday 4) within working hours, but it's a holiday
    expect(isWithinWorkingHours(officeHours, new Date('2026-01-01T14:00:00Z'))).toBe(false);
  });
});
