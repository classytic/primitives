import { describe, expect, it } from 'vitest';
import {
  assertPurgeEvidence,
  createPurgeEvidence,
  type CreatePurgeEvidenceInput,
  isPurgeEvidence,
  type PurgeEvidence,
} from '../../src/retention/purge-evidence.js';

const baseInput = (): CreatePurgeEvidenceInput => ({
  subject: { ref: 'customer:c_123', model: 'Customer' },
  scope: 'org:org_bd_dhaka',
  strategy: 'anonymize',
  measuresRetained: true,
  processed: 4210,
  actor: { ref: 'user:admin_7', kind: 'user' },
  reason: 'GDPR erasure request #4821',
  legalBasis: 'GDPR Art. 17',
});

describe('createPurgeEvidence', () => {
  it('fills id + occurredAt when absent, preserves all inputs', () => {
    const before = Date.now();
    const e = createPurgeEvidence(baseInput());
    const after = Date.now();

    expect(typeof e.id).toBe('string');
    expect(e.id.length).toBeGreaterThan(0);
    expect(e.occurredAt).toBeInstanceOf(Date);
    expect(e.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(e.occurredAt.getTime()).toBeLessThanOrEqual(after);

    expect(e.subject).toEqual({ ref: 'customer:c_123', model: 'Customer' });
    expect(e.scope).toBe('org:org_bd_dhaka');
    expect(e.strategy).toBe('anonymize');
    expect(e.measuresRetained).toBe(true);
    expect(e.processed).toBe(4210);
    expect(e.actor).toEqual({ ref: 'user:admin_7', kind: 'user' });
    expect(e.reason).toBe('GDPR erasure request #4821');
    expect(e.legalBasis).toBe('GDPR Art. 17');
    // status defaults to 'completed'.
    expect(e.status).toBe('completed');
  });

  it('defaults status to completed; honors an explicit status', () => {
    expect(createPurgeEvidence(baseInput()).status).toBe('completed');
    expect(createPurgeEvidence({ ...baseInput(), status: 'partial' }).status).toBe('partial');
  });

  it('passes through operationId / times / results / verification when provided', () => {
    const started = new Date('2026-07-24T00:00:00.000Z');
    const finished = new Date('2026-07-24T00:05:00.000Z');
    const e = createPurgeEvidence({
      ...baseInput(),
      operationId: 'op_42',
      status: 'partial',
      startedAt: started,
      completedAt: finished,
      results: [
        { resource: 'orders', processed: 5, ok: true },
        { resource: 'ledger', processed: 2, ok: false, error: 'closed period' },
      ],
      verification: { ok: false, checks: 3, note: 'ledger failed' },
    });
    expect(e.operationId).toBe('op_42');
    expect(e.startedAt).toBe(started);
    expect(e.completedAt).toBe(finished);
    expect(e.results).toHaveLength(2);
    expect(e.verification).toEqual({ ok: false, checks: 3, note: 'ledger failed' });
    expect(isPurgeEvidence(e)).toBe(true);
  });

  it('omits operationId / times / results / verification when not provided (no undefined keys)', () => {
    const e = createPurgeEvidence(baseInput());
    expect('operationId' in e).toBe(false);
    expect('startedAt' in e).toBe(false);
    expect('completedAt' in e).toBe(false);
    expect('results' in e).toBe(false);
    expect('verification' in e).toBe(false);
  });

  it('honors caller-supplied id + occurredAt over the generated defaults', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const e = createPurgeEvidence({ ...baseInput(), id: 'ev_fixed', occurredAt: when });
    expect(e.id).toBe('ev_fixed');
    expect(e.occurredAt).toBe(when);
  });

  it('generates unique ids across calls', () => {
    const a = createPurgeEvidence(baseInput());
    const b = createPurgeEvidence(baseInput());
    expect(a.id).not.toBe(b.id);
  });

  it('omits legalBasis when not provided (no undefined key)', () => {
    const { legalBasis: _drop, ...rest } = baseInput();
    const e = createPurgeEvidence(rest);
    expect('legalBasis' in e).toBe(false);
  });

  it('supports the hard + measuresRetained:false erasure shape', () => {
    const e = createPurgeEvidence({
      ...baseInput(),
      strategy: 'hard',
      measuresRetained: false,
      legalBasis: undefined,
    });
    expect(e.strategy).toBe('hard');
    expect(e.measuresRetained).toBe(false);
    expect(isPurgeEvidence(e)).toBe(true);
  });
});

describe('isPurgeEvidence', () => {
  it('accepts a well-formed record (built + hand-authored)', () => {
    expect(isPurgeEvidence(createPurgeEvidence(baseInput()))).toBe(true);
    const hand: PurgeEvidence = {
      id: 'ev_1',
      subject: { ref: 'lead:l_9' },
      scope: 'generation:5',
      strategy: 'soft',
      status: 'completed',
      measuresRetained: true,
      processed: 0,
      occurredAt: new Date(),
      actor: { ref: 'service:retention-cron', kind: 'service' },
      reason: 'retention window elapsed',
    };
    expect(isPurgeEvidence(hand)).toBe(true);
  });

  it('rejects nullish and primitives', () => {
    expect(isPurgeEvidence(null)).toBe(false);
    expect(isPurgeEvidence(undefined)).toBe(false);
    expect(isPurgeEvidence('nope')).toBe(false);
    expect(isPurgeEvidence(42)).toBe(false);
  });

  it('rejects an out-of-set strategy (e.g. skip / custom)', () => {
    const e = createPurgeEvidence(baseInput());
    expect(isPurgeEvidence({ ...e, strategy: 'skip' })).toBe(false);
    expect(isPurgeEvidence({ ...e, strategy: 'custom' })).toBe(false);
  });

  it('rejects a bad actor.kind', () => {
    const e = createPurgeEvidence(baseInput());
    expect(isPurgeEvidence({ ...e, actor: { ref: 'x', kind: 'robot' } })).toBe(false);
  });

  it('rejects malformed subject / actor / dates / numbers', () => {
    const e = createPurgeEvidence(baseInput());
    expect(isPurgeEvidence({ ...e, subject: { model: 'X' } })).toBe(false); // no ref
    expect(isPurgeEvidence({ ...e, actor: null })).toBe(false);
    expect(isPurgeEvidence({ ...e, occurredAt: '2026-01-01' })).toBe(false); // not a Date
    expect(isPurgeEvidence({ ...e, occurredAt: new Date('nope') })).toBe(false); // invalid Date
    expect(isPurgeEvidence({ ...e, processed: -1 })).toBe(false);
    expect(isPurgeEvidence({ ...e, processed: Number.NaN })).toBe(false);
    expect(isPurgeEvidence({ ...e, id: '' })).toBe(false);
    expect(isPurgeEvidence({ ...e, legalBasis: 42 })).toBe(false);
  });

  it('rejects empty required strings (scope/reason/refs) and fractional processed', () => {
    const e = createPurgeEvidence(baseInput());
    expect(isPurgeEvidence({ ...e, scope: '' })).toBe(false);
    expect(isPurgeEvidence({ ...e, reason: '' })).toBe(false);
    expect(isPurgeEvidence({ ...e, subject: { ref: '' } })).toBe(false);
    expect(isPurgeEvidence({ ...e, actor: { ref: '', kind: 'user' } })).toBe(false);
    expect(isPurgeEvidence({ ...e, processed: 1.5 })).toBe(false); // must be an integer
    expect(isPurgeEvidence({ ...e, operationId: '' })).toBe(false);
    expect(isPurgeEvidence({ ...e, legalBasis: '' })).toBe(false);
  });

  it('rejects a missing / out-of-set status', () => {
    const e = createPurgeEvidence(baseInput());
    const { status: _drop, ...noStatus } = e;
    expect(isPurgeEvidence(noStatus)).toBe(false);
    expect(isPurgeEvidence({ ...e, status: 'bogus' })).toBe(false);
  });

  it('rejects malformed results / verification / times', () => {
    const e = createPurgeEvidence(baseInput());
    expect(isPurgeEvidence({ ...e, results: [{ resource: '', processed: 1, ok: true }] })).toBe(
      false,
    );
    expect(isPurgeEvidence({ ...e, results: [{ resource: 'x', processed: 1.5, ok: true }] })).toBe(
      false,
    );
    expect(isPurgeEvidence({ ...e, results: 'nope' })).toBe(false);
    expect(isPurgeEvidence({ ...e, verification: { ok: 'yes' } })).toBe(false);
    expect(isPurgeEvidence({ ...e, verification: { ok: true, checks: 1.5 } })).toBe(false);
    expect(isPurgeEvidence({ ...e, startedAt: new Date('nope') })).toBe(false);
    expect(isPurgeEvidence({ ...e, completedAt: 'not-a-date' })).toBe(false);
  });

  it('accepts a missing optional model / legalBasis', () => {
    const e = createPurgeEvidence({ ...baseInput(), legalBasis: undefined });
    const noModel = { ...e, subject: { ref: 'x' } };
    expect(isPurgeEvidence(noModel)).toBe(true);
  });
});

describe('assertPurgeEvidence', () => {
  it('passes for a valid record', () => {
    expect(() => assertPurgeEvidence(createPurgeEvidence(baseInput()))).not.toThrow();
  });

  it('throws TypeError for an invalid record', () => {
    expect(() => assertPurgeEvidence({ id: 'x' })).toThrow(TypeError);
    expect(() => assertPurgeEvidence(null)).toThrow(/Invalid PurgeEvidence/);
  });
});
