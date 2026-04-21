import { describe, expect, it } from 'vitest';
import {
  activeHolds,
  addHold,
  type HoldActor,
  type HoldError,
  type HoldReason,
  hasActiveHoldOfCode,
  isOnHold,
  resolvedHolds,
  resolveHold,
} from '../../src/hold.js';

const systemActor: HoldActor = { id: 'system', kind: 'system' };
const userActor: HoldActor = { id: 'user_1', kind: 'user', name: 'Alice' };

describe('addHold', () => {
  it('adds a hold to an empty collection', () => {
    const holds = addHold([], {
      code: 'fraud_review',
      note: 'high velocity',
      actor: systemActor,
    });
    expect(holds).toHaveLength(1);
    expect(holds[0]?.code).toBe('fraud_review');
    expect(holds[0]?.note).toBe('high velocity');
    expect(holds[0]?.actor).toEqual(systemActor);
    expect(holds[0]?.createdAt).toBeInstanceOf(Date);
    expect(holds[0]?.resolvedAt).toBeUndefined();
  });

  it('generates a unique id if omitted', () => {
    const a = addHold([], { code: 'x', actor: systemActor });
    const b = addHold(a, { code: 'y', actor: systemActor });
    expect(b[0]?.id).toBeDefined();
    expect(b[1]?.id).toBeDefined();
    expect(b[0]?.id).not.toBe(b[1]?.id);
  });

  it('accepts a caller-supplied id', () => {
    const holds = addHold([], {
      id: 'custom_1',
      code: 'x',
      actor: systemActor,
    });
    expect(holds[0]?.id).toBe('custom_1');
  });

  it('rejects empty or whitespace-only codes', () => {
    for (const bad of ['', '   ', '\t']) {
      try {
        addHold([], { code: bad, actor: systemActor });
        expect.fail(`should throw for code="${bad}"`);
      } catch (e) {
        expect((e as HoldError).code).toBe('INVALID_CODE');
      }
    }
  });

  it('rejects duplicate ids', () => {
    const a = addHold([], { id: 'dup', code: 'x', actor: systemActor });
    try {
      addHold(a, { id: 'dup', code: 'y', actor: systemActor });
      expect.fail('should throw');
    } catch (e) {
      expect((e as HoldError).code).toBe('DUPLICATE_HOLD_ID');
    }
  });

  it('preserves caller-supplied createdAt and metadata', () => {
    const when = new Date('2026-04-17T12:00:00Z');
    const holds = addHold([], {
      code: 'x',
      actor: systemActor,
      createdAt: when,
      metadata: { ticket: 'INCIDENT-42', severity: 'high' },
    });
    expect(holds[0]?.createdAt).toBe(when);
    expect(holds[0]?.metadata).toEqual({ ticket: 'INCIDENT-42', severity: 'high' });
  });

  it('returns a new array — does not mutate input', () => {
    const before: readonly HoldReason[] = [];
    const after = addHold(before, { code: 'x', actor: systemActor });
    expect(before).toHaveLength(0);
    expect(after).toHaveLength(1);
  });
});

describe('resolveHold', () => {
  it('marks the matching hold resolved', () => {
    let holds = addHold([], { id: 'h1', code: 'x', actor: systemActor });
    const when = new Date('2026-04-17T13:00:00Z');
    holds = resolveHold(holds, 'h1', {
      actor: userActor,
      note: 'override ok',
      resolvedAt: when,
    });
    expect(holds[0]?.resolvedAt).toBe(when);
    expect(holds[0]?.resolvedBy).toEqual(userActor);
    expect(holds[0]?.resolutionNote).toBe('override ok');
  });

  it('throws on unknown id', () => {
    try {
      resolveHold([], 'nope', { actor: userActor });
      expect.fail('should throw');
    } catch (e) {
      expect((e as HoldError).code).toBe('UNKNOWN_HOLD_ID');
    }
  });

  it('throws when resolving an already-resolved hold', () => {
    let holds = addHold([], { id: 'h1', code: 'x', actor: systemActor });
    holds = resolveHold(holds, 'h1', { actor: userActor });
    try {
      resolveHold(holds, 'h1', { actor: userActor });
      expect.fail('should throw');
    } catch (e) {
      expect((e as HoldError).code).toBe('ALREADY_RESOLVED');
    }
  });

  it('only resolves the matching hold — leaves others untouched', () => {
    let holds: readonly HoldReason[] = [];
    holds = addHold(holds, { id: 'h1', code: 'fraud', actor: systemActor });
    holds = addHold(holds, { id: 'h2', code: 'credit', actor: systemActor });
    holds = resolveHold(holds, 'h1', { actor: userActor });
    expect(holds[0]?.resolvedAt).toBeInstanceOf(Date);
    expect(holds[1]?.resolvedAt).toBeUndefined();
  });
});

describe('queries — activeHolds / isOnHold / hasActiveHoldOfCode / resolvedHolds', () => {
  it('activeHolds filters out resolved', () => {
    let holds: readonly HoldReason[] = [];
    holds = addHold(holds, { id: 'h1', code: 'fraud', actor: systemActor });
    holds = addHold(holds, { id: 'h2', code: 'credit', actor: systemActor });
    holds = resolveHold(holds, 'h1', { actor: userActor });
    expect(activeHolds(holds).map((h) => h.id)).toEqual(['h2']);
  });

  it('isOnHold reflects any active hold', () => {
    let holds: readonly HoldReason[] = [];
    expect(isOnHold(holds)).toBe(false);
    holds = addHold(holds, { id: 'h1', code: 'x', actor: systemActor });
    expect(isOnHold(holds)).toBe(true);
    holds = resolveHold(holds, 'h1', { actor: userActor });
    expect(isOnHold(holds)).toBe(false);
  });

  it('hasActiveHoldOfCode matches by code among active holds only', () => {
    let holds: readonly HoldReason[] = [];
    holds = addHold(holds, { id: 'h1', code: 'fraud', actor: systemActor });
    holds = addHold(holds, { id: 'h2', code: 'credit', actor: systemActor });
    expect(hasActiveHoldOfCode(holds, 'fraud')).toBe(true);
    expect(hasActiveHoldOfCode(holds, 'missing')).toBe(false);
    holds = resolveHold(holds, 'h1', { actor: userActor });
    expect(hasActiveHoldOfCode(holds, 'fraud')).toBe(false);
  });

  it('resolvedHolds returns only resolved entries', () => {
    let holds: readonly HoldReason[] = [];
    holds = addHold(holds, { id: 'h1', code: 'fraud', actor: systemActor });
    holds = addHold(holds, { id: 'h2', code: 'credit', actor: systemActor });
    holds = resolveHold(holds, 'h1', { actor: userActor });
    expect(resolvedHolds(holds).map((h) => h.id)).toEqual(['h1']);
  });
});
