import { describe, expect, it } from 'vitest';
import {
  ConditionError,
  evaluate,
  validateCondition,
  type Condition,
} from '../../src/workflow/condition.js';

describe('evaluate — field conditions', () => {
  const target = {
    status: 'won',
    priority: 'high',
    score: 75,
    email: 'a@b.c',
    tags: ['hot', 'enterprise'],
    closedAt: new Date('2026-01-15T00:00:00Z'),
    note: null,
    contact: { city: 'Dhaka' },
  };

  it('eq / neq', () => {
    expect(evaluate({ field: 'status', op: 'eq', value: 'won' }, target)).toBe(true);
    expect(evaluate({ field: 'status', op: 'neq', value: 'lost' }, target)).toBe(true);
    expect(evaluate({ field: 'status', op: 'eq', value: 'lost' }, target)).toBe(false);
  });

  it('numeric comparisons', () => {
    expect(evaluate({ field: 'score', op: 'gt', value: 50 }, target)).toBe(true);
    expect(evaluate({ field: 'score', op: 'gte', value: 75 }, target)).toBe(true);
    expect(evaluate({ field: 'score', op: 'lt', value: 50 }, target)).toBe(false);
    expect(evaluate({ field: 'score', op: 'lte', value: 75 }, target)).toBe(true);
  });

  it('in / nin against arrays', () => {
    expect(evaluate({ field: 'priority', op: 'in', value: ['high', 'urgent'] }, target)).toBe(
      true,
    );
    expect(evaluate({ field: 'priority', op: 'nin', value: ['low', 'medium'] }, target)).toBe(
      true,
    );
  });

  it('contains scans a target array', () => {
    expect(evaluate({ field: 'tags', op: 'contains', value: 'hot' }, target)).toBe(true);
    expect(evaluate({ field: 'tags', op: 'contains', value: 'cold' }, target)).toBe(false);
  });

  it('startsWith / endsWith on strings', () => {
    expect(evaluate({ field: 'email', op: 'startsWith', value: 'a@' }, target)).toBe(true);
    expect(evaluate({ field: 'email', op: 'endsWith', value: '.c' }, target)).toBe(true);
  });

  it('isNull / isNotNull', () => {
    expect(evaluate({ field: 'note', op: 'isNull' }, target)).toBe(true);
    expect(evaluate({ field: 'status', op: 'isNotNull' }, target)).toBe(true);
    expect(evaluate({ field: 'missing.path', op: 'isNull' }, target)).toBe(true);
  });

  it('walks dotted paths', () => {
    expect(evaluate({ field: 'contact.city', op: 'eq', value: 'Dhaka' }, target)).toBe(true);
  });

  it('handles Date comparisons (Date vs Date and Date vs ISO string)', () => {
    expect(
      evaluate(
        { field: 'closedAt', op: 'gt', value: new Date('2026-01-01T00:00:00Z') },
        target,
      ),
    ).toBe(true);
    expect(
      evaluate({ field: 'closedAt', op: 'eq', value: '2026-01-15T00:00:00.000Z' }, target),
    ).toBe(true);
  });

  it('returns false (not throws) when paths are missing', () => {
    expect(evaluate({ field: 'no.such.path', op: 'eq', value: 'x' }, target)).toBe(false);
  });
});

describe('evaluate — composite conditions', () => {
  const target = { status: 'won', score: 75, owner: 'alice' };

  it('all = AND', () => {
    const c: Condition = {
      all: [
        { field: 'status', op: 'eq', value: 'won' },
        { field: 'score', op: 'gt', value: 50 },
      ],
    };
    expect(evaluate(c, target)).toBe(true);

    const c2: Condition = {
      all: [
        { field: 'status', op: 'eq', value: 'won' },
        { field: 'score', op: 'gt', value: 100 },
      ],
    };
    expect(evaluate(c2, target)).toBe(false);
  });

  it('any = OR with short-circuit', () => {
    const c: Condition = {
      any: [
        { field: 'status', op: 'eq', value: 'lost' },
        { field: 'owner', op: 'eq', value: 'alice' },
      ],
    };
    expect(evaluate(c, target)).toBe(true);
  });

  it('not inverts the wrapped condition', () => {
    expect(
      evaluate({ not: { field: 'status', op: 'eq', value: 'lost' } }, target),
    ).toBe(true);
  });

  it('composes deeply (drip "if opened in last 7d AND not clicked")', () => {
    const target = {
      lastOpenedAt: new Date('2026-01-13T00:00:00Z'),
      lastClickedAt: null,
    };
    const sevenDaysAgo = new Date('2026-01-09T00:00:00Z');
    const c: Condition = {
      all: [
        { field: 'lastOpenedAt', op: 'gte', value: sevenDaysAgo },
        { field: 'lastClickedAt', op: 'isNull' },
      ],
    };
    expect(evaluate(c, target)).toBe(true);
  });
});

describe('validateCondition', () => {
  it('accepts a valid field condition', () => {
    expect(() => validateCondition({ field: 'x', op: 'eq', value: 1 })).not.toThrow();
  });

  it('accepts unary op without value', () => {
    expect(() => validateCondition({ field: 'x', op: 'isNull' })).not.toThrow();
  });

  it('rejects unknown comparator (INVALID_OP)', () => {
    expect(() =>
      validateCondition({ field: 'x', op: 'matches' as any, value: 1 }),
    ).toThrow(ConditionError);
  });

  it('rejects non-unary op missing value (MISSING_VALUE)', () => {
    expect(() => validateCondition({ field: 'x', op: 'eq' })).toThrow(
      /comparator 'eq' requires a value/,
    );
  });

  it('rejects empty all-group (EMPTY_GROUP)', () => {
    expect(() => validateCondition({ all: [] })).toThrow(/at least one branch/);
  });

  it('rejects empty any-group', () => {
    expect(() => validateCondition({ any: [] })).toThrow(/at least one branch/);
  });

  it('recursively validates inside composites', () => {
    expect(() =>
      validateCondition({
        all: [{ field: 'x', op: 'badop' as any, value: 1 }],
      }),
    ).toThrow(ConditionError);
  });

  it('rejects null / non-object input', () => {
    expect(() => validateCondition(null as any)).toThrow(/null or not an object/);
  });
});
