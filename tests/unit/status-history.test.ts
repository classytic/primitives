import { describe, expect, it } from 'vitest';
import {
  appendStatus,
  latestEntry,
  lastTransitionTo,
  timeInStatus,
  type StatusHistory,
} from '../../src/workflow/status-history.js';

type LeadStatus = 'new' | 'qualified' | 'converted' | 'disqualified';

describe('appendStatus', () => {
  it('starts with durationInPriorMs=0 for the first entry', () => {
    const at = new Date('2026-01-01T10:00:00Z');
    const history = appendStatus<LeadStatus>([], 'new', { at });
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe('new');
    expect(history[0]!.durationInPriorMs).toBe(0);
    expect(history[0]!.occurredAt).toEqual(at);
  });

  it('computes duration-in-prior between entries', () => {
    const t0 = new Date('2026-01-01T10:00:00Z');
    const t1 = new Date('2026-01-01T10:05:00Z'); // +5 min
    let history: StatusHistory<LeadStatus> = appendStatus([], 'new', { at: t0 });
    history = appendStatus(history, 'qualified', { at: t1 });
    expect(history[1]!.durationInPriorMs).toBe(5 * 60 * 1000);
  });

  it('does not mutate the input array', () => {
    const original: StatusHistory<LeadStatus> = appendStatus([], 'new', {
      at: new Date('2026-01-01T10:00:00Z'),
    });
    const next = appendStatus(original, 'qualified', {
      at: new Date('2026-01-01T11:00:00Z'),
    });
    expect(original).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next).not.toBe(original);
  });

  it('attaches `by` and `note` when provided', () => {
    const entry = appendStatus<LeadStatus>([], 'qualified', {
      at: new Date(),
      by: 'sdr:alice',
      note: 'Hit ICP after call',
    })[0]!;
    expect(entry.by).toBe('sdr:alice');
    expect(entry.note).toBe('Hit ICP after call');
  });

  it('clamps negative durations to 0 (clock skew defense)', () => {
    const t0 = new Date('2026-01-01T10:00:00Z');
    const t1 = new Date('2026-01-01T09:00:00Z'); // earlier than t0 — skew
    let history: StatusHistory<LeadStatus> = appendStatus([], 'new', { at: t0 });
    history = appendStatus(history, 'qualified', { at: t1 });
    expect(history[1]!.durationInPriorMs).toBe(0);
  });
});

describe('timeInStatus', () => {
  it('sums duration across multiple visits to the same status', () => {
    let history: StatusHistory<LeadStatus> = appendStatus([], 'new', {
      at: new Date('2026-01-01T10:00:00Z'),
    });
    history = appendStatus(history, 'qualified', {
      at: new Date('2026-01-01T10:10:00Z'),
    });
    // total in 'new' = 10 min (exited to qualified after 10 min)
    expect(timeInStatus(history, 'new')).toBe(10 * 60 * 1000);
  });

  it('counts time still elapsing in the current status', () => {
    const t0 = new Date('2026-01-01T10:00:00Z');
    const history = appendStatus<LeadStatus>([], 'new', { at: t0 });
    const now = new Date('2026-01-01T10:30:00Z'); // 30 min later, still in 'new'
    expect(timeInStatus(history, 'new', now)).toBe(30 * 60 * 1000);
  });

  it('returns 0 when the status never appeared', () => {
    const history = appendStatus<LeadStatus>([], 'new', {
      at: new Date('2026-01-01T10:00:00Z'),
    });
    expect(timeInStatus(history, 'converted')).toBe(0);
  });
});

describe('latestEntry / lastTransitionTo', () => {
  it('latestEntry returns null for empty history', () => {
    expect(latestEntry<LeadStatus>([])).toBeNull();
  });

  it('latestEntry returns the last entry', () => {
    let history: StatusHistory<LeadStatus> = appendStatus([], 'new', {
      at: new Date('2026-01-01T10:00:00Z'),
    });
    history = appendStatus(history, 'qualified', {
      at: new Date('2026-01-01T11:00:00Z'),
    });
    expect(latestEntry(history)!.status).toBe('qualified');
  });

  it('lastTransitionTo finds the most recent occurrence of a status', () => {
    let history: StatusHistory<LeadStatus> = appendStatus([], 'new', {
      at: new Date('2026-01-01T10:00:00Z'),
    });
    history = appendStatus(history, 'qualified', {
      at: new Date('2026-01-01T11:00:00Z'),
    });
    history = appendStatus(history, 'new', {
      at: new Date('2026-01-01T12:00:00Z'),
    });
    history = appendStatus(history, 'converted', {
      at: new Date('2026-01-01T13:00:00Z'),
    });
    const found = lastTransitionTo(history, 'new');
    expect(found).not.toBeNull();
    expect(found!.occurredAt).toEqual(new Date('2026-01-01T12:00:00Z'));
  });

  it('lastTransitionTo returns null when the status is absent', () => {
    const history = appendStatus<LeadStatus>([], 'new', {
      at: new Date('2026-01-01T10:00:00Z'),
    });
    expect(lastTransitionTo(history, 'converted')).toBeNull();
  });
});
