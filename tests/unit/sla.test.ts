import { describe, expect, it } from 'vitest';
import {
  breachedAt,
  consumedFraction,
  elapsedMs,
  isBreached,
  remainingMs,
  type SLA,
  type SLAError,
  validateSLA,
} from '../../src/sla.js';

const twoHours: SLA = {
  targetDurationMs: 2 * 60 * 60 * 1000,
  breachPolicy: 'escalate',
};

describe('validateSLA', () => {
  it('rejects non-positive / non-integer / non-finite targets', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        validateSLA({ targetDurationMs: bad, breachPolicy: 'warn' });
        expect.fail(`should throw for target=${bad}`);
      } catch (e) {
        expect((e as SLAError).code).toBe('INVALID_TARGET');
      }
    }
  });

  it('accepts positive integer targets', () => {
    expect(() => validateSLA({ targetDurationMs: 1, breachPolicy: 'warn' })).not.toThrow();
  });
});

describe('breachedAt', () => {
  it('returns startedAt + target', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    expect(breachedAt(twoHours, started).toISOString()).toBe('2026-04-17T12:00:00.000Z');
  });

  it('throws on invalid startedAt', () => {
    try {
      breachedAt(twoHours, new Date('not-a-date'));
      expect.fail('should throw');
    } catch (e) {
      expect((e as SLAError).code).toBe('INVALID_START');
    }
  });
});

describe('remainingMs', () => {
  it('positive before deadline', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    expect(remainingMs(twoHours, started, new Date('2026-04-17T11:00:00Z'))).toBe(60 * 60 * 1000);
  });

  it('zero at deadline', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    expect(remainingMs(twoHours, started, new Date('2026-04-17T12:00:00Z'))).toBe(0);
  });

  it('negative past deadline', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    expect(remainingMs(twoHours, started, new Date('2026-04-17T13:00:00Z'))).toBe(-60 * 60 * 1000);
  });
});

describe('elapsedMs', () => {
  it('measures elapsed time since start', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    expect(elapsedMs(started, new Date('2026-04-17T10:30:00Z'))).toBe(30 * 60 * 1000);
  });

  it('is zero when now equals startedAt', () => {
    const d = new Date();
    expect(elapsedMs(d, d)).toBe(0);
  });
});

describe('isBreached', () => {
  it('false before deadline', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    expect(isBreached(twoHours, started, new Date('2026-04-17T11:00:00Z'))).toBe(false);
  });

  it('true at deadline (deadline is inclusive breach)', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    expect(isBreached(twoHours, started, new Date('2026-04-17T12:00:00Z'))).toBe(true);
  });

  it('true past deadline', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    expect(isBreached(twoHours, started, new Date('2026-04-17T12:01:00Z'))).toBe(true);
  });
});

describe('consumedFraction', () => {
  it('0 at start, 1 at deadline, > 1 past deadline', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    expect(consumedFraction(twoHours, started, started)).toBe(0);
    expect(consumedFraction(twoHours, started, new Date('2026-04-17T11:00:00Z'))).toBe(0.5);
    expect(consumedFraction(twoHours, started, new Date('2026-04-17T12:00:00Z'))).toBe(1);
    expect(consumedFraction(twoHours, started, new Date('2026-04-17T13:00:00Z'))).toBe(1.5);
  });

  it('useful for early-warning thresholds (80% consumed)', () => {
    const started = new Date('2026-04-17T10:00:00Z');
    const f = consumedFraction(twoHours, started, new Date('2026-04-17T11:36:00Z'));
    expect(f).toBe(0.8);
    expect(f >= 0.8 && !isBreached(twoHours, started, new Date('2026-04-17T11:36:00Z'))).toBe(true);
  });
});

describe('breach-policy field is carried but not executed', () => {
  it('breachPolicy is host-interpreted — primitive does not act on it', () => {
    const sla: SLA = {
      targetDurationMs: 1000,
      breachPolicy: 'block',
      breachActionRef: 'webhook:https://host.example/breach',
      label: 'Tier-1 pick SLA',
    };
    // Pure data — just validates shape passes through.
    expect(sla.breachPolicy).toBe('block');
    expect(sla.breachActionRef).toContain('webhook:');
    expect(sla.label).toBeTruthy();
  });
});
