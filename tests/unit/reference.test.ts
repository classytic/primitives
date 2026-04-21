import { describe, expect, it } from 'vitest';
import { idToString, isExternalRef } from '../../src/reference.js';
import { makeExternalRef } from '../helpers/fixtures.js';

describe('idToString', () => {
  it('returns string unchanged', () => {
    expect(idToString('abc123')).toBe('abc123');
  });

  it('calls toString on ObjectIdLike', () => {
    const fake = { toString: () => 'obj_hex_value' };
    expect(idToString(fake)).toBe('obj_hex_value');
  });

  it('works with Mongoose-like ObjectIdLike (toHexString optional)', () => {
    const fake = {
      toString: () => '507f1f77bcf86cd799439011',
      toHexString: () => '507f1f77bcf86cd799439011',
    };
    expect(idToString(fake)).toBe('507f1f77bcf86cd799439011');
  });
});

describe('isExternalRef', () => {
  it('accepts shape with both fields', () => {
    expect(isExternalRef(makeExternalRef())).toBe(true);
    expect(isExternalRef({ sourceId: 'x', sourceModel: 'Order' })).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isExternalRef({ sourceId: 'x' })).toBe(false);
    expect(isExternalRef({ sourceModel: 'Order' })).toBe(false);
    expect(isExternalRef({})).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isExternalRef({ sourceId: 1, sourceModel: 'Order' })).toBe(false);
    expect(isExternalRef({ sourceId: 'x', sourceModel: 1 })).toBe(false);
  });

  it('rejects nullish and primitives', () => {
    expect(isExternalRef(null)).toBe(false);
    expect(isExternalRef(undefined)).toBe(false);
    expect(isExternalRef('src')).toBe(false);
    expect(isExternalRef(42)).toBe(false);
  });
});
