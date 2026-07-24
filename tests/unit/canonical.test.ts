/**
 * Strict canonical JSON + digests (@classytic/primitives/canonical).
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  CanonicalizeError,
  canonicalJson,
  sha256Hex,
} from '../../src/serialization/canonical.js';

describe('canonicalJson', () => {
  it('is key-order invariant', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serializes Date explicitly so timestamps participate in the digest', () => {
    const a = canonicalJson({ at: new Date('2026-07-24T00:00:00.000Z') });
    const b = canonicalJson({ at: new Date('2026-07-24T00:00:01.000Z') });
    expect(a).not.toBe(b);
    expect(a).toContain('$date');
  });

  it('rejects non-finite numbers, bigint, function, symbol, undefined', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(CanonicalizeError);
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalJson({ b: 10n })).toThrow(/bigint/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/function/);
    expect(() => canonicalJson({ s: Symbol('x') })).toThrow(/symbol/);
    expect(() => canonicalJson({ u: undefined })).toThrow(/undefined/);
  });

  it('rejects Map / Set and cyclic references and invalid Dates', () => {
    expect(() => canonicalJson({ m: new Map() })).toThrow(/Map/);
    expect(() => canonicalJson({ s: new Set() })).toThrow(/Set/);
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalJson(a)).toThrow(/cyclic/);
    expect(() => canonicalJson({ at: new Date('nope') })).toThrow(/invalid Date/);
  });
});

describe('sha256Hex / canonicalDigest', () => {
  it('sha256Hex is a stable 64-char hex digest', () => {
    expect(sha256Hex('abc')).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
  });

  it('canonicalDigest = sha256Hex(canonicalJson(value)), key-order stable', () => {
    expect(canonicalDigest({ b: 1, a: 2 })).toBe(sha256Hex(canonicalJson({ a: 2, b: 1 })));
    expect(canonicalDigest({ x: 1 })).not.toBe(canonicalDigest({ x: 2 }));
  });
});
