import { describe, expect, it } from 'vitest';
import {
  allocate,
  isBalanced,
  SplitAllocationError,
  type SplitMethod,
  type SplitResult,
  type SplitSubject,
} from '../../src/split-allocation.js';

function sumOfParts(result: SplitResult): number {
  return result.parts.reduce((acc, p) => acc + p.amount, 0);
}

describe('allocate — validation', () => {
  it('rejects non-integer total', () => {
    expect(() => allocate(1.5, [{ id: 'A', weight: 1 }], 'by-weight')).toThrow(
      SplitAllocationError,
    );
    expect(() => allocate(Number.NaN, [{ id: 'A', weight: 1 }], 'by-weight')).toThrow(
      /INVALID_TOTAL|finite integer/,
    );
    expect(() => allocate(Number.POSITIVE_INFINITY, [{ id: 'A', weight: 1 }], 'by-weight')).toThrow(
      SplitAllocationError,
    );
  });

  it('rejects non-zero total with empty subjects', () => {
    try {
      allocate(100, [], 'by-weight');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SplitAllocationError);
      expect((e as SplitAllocationError).code).toBe('EMPTY_SUBJECTS');
    }
  });

  it('accepts zero total with empty subjects — returns empty parts', () => {
    const r = allocate(0, [], 'by-weight');
    expect(r.parts).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('rejects duplicate subject ids', () => {
    try {
      allocate(
        100,
        [
          { id: 'A', weight: 1 },
          { id: 'A', weight: 2 },
        ],
        'by-weight',
      );
      expect.fail('should throw');
    } catch (e) {
      expect((e as SplitAllocationError).code).toBe('DUPLICATE_SUBJECT_ID');
    }
  });
});

describe('allocate — method=by-weight and other proportional methods', () => {
  it('allocates exactly when division is clean', () => {
    const r = allocate(
      1000,
      [
        { id: 'L1', weight: 2 },
        { id: 'L2', weight: 3 },
        { id: 'L3', weight: 5 },
      ],
      'by-weight',
    );
    expect(r.parts.map((p) => p.amount)).toEqual([200, 300, 500]);
    expect(isBalanced(r)).toBe(true);
  });

  it('distributes residue to largest fractional remainder, tie-break by input order', () => {
    const r = allocate(
      100,
      [
        { id: 'A', weight: 1 },
        { id: 'B', weight: 1 },
        { id: 'C', weight: 1 },
      ],
      'by-weight',
    );
    expect(sumOfParts(r)).toBe(100);
    // raw shares: 33.333 each; floored: 33 each; residue = 1
    // all frac equal → first-order subject gets the +1
    expect(r.parts.map((p) => p.amount)).toEqual([34, 33, 33]);
  });

  it('is deterministic — identical inputs produce identical outputs', () => {
    const subjects: SplitSubject[] = [
      { id: 'A', weight: 7 },
      { id: 'B', weight: 3 },
      { id: 'C', weight: 11 },
      { id: 'D', weight: 29 },
    ];
    const a = allocate(1234, subjects, 'by-weight');
    const b = allocate(1234, subjects, 'by-weight');
    expect(a).toEqual(b);
  });

  it('rejects negative weights', () => {
    try {
      allocate(100, [{ id: 'A', weight: -1 }], 'by-weight');
      expect.fail('should throw');
    } catch (e) {
      expect((e as SplitAllocationError).code).toBe('INVALID_WEIGHT');
    }
  });

  it('rejects non-finite weight', () => {
    expect(() => allocate(100, [{ id: 'A', weight: Number.NaN }], 'by-weight')).toThrow(
      SplitAllocationError,
    );
  });

  it('rejects missing weight when method requires it', () => {
    try {
      allocate(100, [{ id: 'A' }], 'by-weight');
      expect.fail('should throw');
    } catch (e) {
      expect((e as SplitAllocationError).code).toBe('INVALID_WEIGHT');
    }
  });

  it('rejects zero weight sum', () => {
    try {
      allocate(
        100,
        [
          { id: 'A', weight: 0 },
          { id: 'B', weight: 0 },
        ],
        'by-weight',
      );
      expect.fail('should throw');
    } catch (e) {
      expect((e as SplitAllocationError).code).toBe('ZERO_WEIGHT_SUM');
    }
  });

  it('treats by-qty, by-volume, by-value identically to by-weight (semantic label only)', () => {
    const subjects: SplitSubject[] = [
      { id: 'A', weight: 1 },
      { id: 'B', weight: 3 },
    ];
    const methods: SplitMethod[] = ['by-qty', 'by-weight', 'by-volume', 'by-value'];
    const amounts = methods.map((m) => allocate(400, subjects, m).parts.map((p) => p.amount));
    expect(amounts[0]).toEqual([100, 300]);
    for (const a of amounts) expect(a).toEqual([100, 300]);
  });

  it('preserves method label on result for audit trails', () => {
    const r = allocate(100, [{ id: 'A', weight: 1 }], 'by-volume');
    expect(r.method).toBe('by-volume');
  });
});

describe('allocate — method=equal', () => {
  it('divides evenly, distributes residue to earliest subjects', () => {
    const r = allocate(10, [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }], 'equal');
    expect(r.parts.map((p) => p.amount)).toEqual([3, 3, 2, 2]);
    expect(sumOfParts(r)).toBe(10);
  });

  it('ignores any provided weights', () => {
    const r = allocate(
      9,
      [
        { id: 'A', weight: 999 },
        { id: 'B', weight: 1 },
        { id: 'C', weight: 0 },
      ],
      'equal',
    );
    expect(r.parts.map((p) => p.amount)).toEqual([3, 3, 3]);
    expect(r.parts.every((p) => p.weight === 1)).toBe(true);
  });
});

describe('allocate — method=by-percent', () => {
  it('allocates by percent when sum equals 100', () => {
    const r = allocate(
      1000,
      [
        { id: 'A', percent: 50 },
        { id: 'B', percent: 30 },
        { id: 'C', percent: 20 },
      ],
      'by-percent',
    );
    expect(r.parts.map((p) => p.amount)).toEqual([500, 300, 200]);
  });

  it('accepts sum within ±0.001 tolerance (floating drift)', () => {
    // 33.333 + 33.333 + 33.334 = 100 exactly, but safer real-world example:
    const r = allocate(
      300,
      [
        { id: 'A', percent: 33.333 },
        { id: 'B', percent: 33.333 },
        { id: 'C', percent: 33.334 },
      ],
      'by-percent',
    );
    expect(sumOfParts(r)).toBe(300);
  });

  it('rejects sum outside tolerance', () => {
    try {
      allocate(
        100,
        [
          { id: 'A', percent: 40 },
          { id: 'B', percent: 40 },
        ],
        'by-percent',
      );
      expect.fail('should throw');
    } catch (e) {
      expect((e as SplitAllocationError).code).toBe('INVALID_PERCENT');
    }
  });

  it('rejects percent outside [0, 100]', () => {
    expect(() =>
      allocate(
        100,
        [
          { id: 'A', percent: 150 },
          { id: 'B', percent: -50 },
        ],
        'by-percent',
      ),
    ).toThrow(SplitAllocationError);
  });

  it('rejects missing percent', () => {
    try {
      allocate(100, [{ id: 'A' }], 'by-percent');
      expect.fail('should throw');
    } catch (e) {
      expect((e as SplitAllocationError).code).toBe('INVALID_PERCENT');
    }
  });
});

describe('allocate — negative totals', () => {
  it('flips signs but preserves magnitude invariant', () => {
    const r = allocate(
      -1000,
      [
        { id: 'A', weight: 2 },
        { id: 'B', weight: 3 },
        { id: 'C', weight: 5 },
      ],
      'by-weight',
    );
    expect(r.parts.map((p) => p.amount)).toEqual([-200, -300, -500]);
    expect(sumOfParts(r)).toBe(-1000);
  });

  it('handles negative residue — subjects with largest fraction still get the extra -1', () => {
    const r = allocate(
      -100,
      [
        { id: 'A', weight: 1 },
        { id: 'B', weight: 1 },
        { id: 'C', weight: 1 },
      ],
      'by-weight',
    );
    expect(sumOfParts(r)).toBe(-100);
    // same tie-break: first-order subject gets the extra unit (which is -1 here)
    expect(r.parts.map((p) => p.amount)).toEqual([-34, -33, -33]);
  });
});

describe('allocate — zero total', () => {
  it('returns all-zero parts regardless of weights', () => {
    const r = allocate(
      0,
      [
        { id: 'A', weight: 7 },
        { id: 'B', weight: 13 },
      ],
      'by-weight',
    );
    expect(r.parts.map((p) => p.amount)).toEqual([0, 0]);
    expect(sumOfParts(r)).toBe(0);
  });
});

describe('allocate — invariant: sum-exact across many random inputs', () => {
  it('sum(parts) === total for 500 pseudorandom cases', () => {
    // Linear-congruential generator for determinism — no flake across runs.
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let caseIdx = 0; caseIdx < 500; caseIdx++) {
      const n = 2 + Math.floor(rand() * 9); // 2..10 subjects
      const total = Math.floor(rand() * 1_000_000) * (rand() < 0.5 ? 1 : -1);
      const subjects: SplitSubject[] = [];
      for (let i = 0; i < n; i++) {
        subjects.push({ id: `S${i}`, weight: rand() * 1000 });
      }
      const r = allocate(total, subjects, 'by-weight');
      expect(sumOfParts(r)).toBe(total);
      expect(r.parts).toHaveLength(n);
    }
  });
});

describe('isBalanced', () => {
  it('returns true for freshly allocated results', () => {
    const r = allocate(
      1000,
      [
        { id: 'A', weight: 1 },
        { id: 'B', weight: 2 },
      ],
      'by-weight',
    );
    expect(isBalanced(r)).toBe(true);
  });

  it('returns false if a part has been tampered with', () => {
    const r = allocate(
      1000,
      [
        { id: 'A', weight: 1 },
        { id: 'B', weight: 1 },
      ],
      'by-weight',
    );
    const [first, second] = r.parts;
    if (!first || !second) throw new Error('expected two parts');
    const tampered: SplitResult = {
      total: r.total,
      method: r.method,
      parts: [{ id: first.id, amount: first.amount + 1, weight: first.weight }, second],
    };
    expect(isBalanced(tampered)).toBe(false);
  });
});
