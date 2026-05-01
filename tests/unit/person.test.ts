import { describe, expect, it } from 'vitest';
import { formatDisplayName, formatFullName, type PersonName } from '../../src/person.js';

describe('formatFullName', () => {
  it('joins given + family with a space', () => {
    const n: PersonName = { given: 'Ada', family: 'Lovelace' };
    expect(formatFullName(n)).toBe('Ada Lovelace');
  });

  it('includes prefix, middle, and suffix when present', () => {
    const n: PersonName = {
      prefix: 'Dr.',
      given: 'Augusta',
      middle: 'Ada',
      family: 'King-Noel',
      suffix: 'PhD',
    };
    expect(formatFullName(n)).toBe('Dr. Augusta Ada King-Noel PhD');
  });

  it('skips empty and whitespace-only parts', () => {
    const n: PersonName = { given: 'Ada', middle: '   ', family: 'Lovelace' };
    expect(formatFullName(n)).toBe('Ada Lovelace');
  });
});

describe('formatDisplayName', () => {
  it('returns the preferred name when set and non-empty', () => {
    const n: PersonName = { given: 'Augusta', family: 'King-Noel', preferred: 'Ada' };
    expect(formatDisplayName(n)).toBe('Ada');
  });

  it('falls back to given + family when preferred is absent', () => {
    const n: PersonName = { given: 'Ada', family: 'Lovelace' };
    expect(formatDisplayName(n)).toBe('Ada Lovelace');
  });

  it('falls back when preferred is whitespace-only', () => {
    const n: PersonName = { given: 'Ada', family: 'Lovelace', preferred: '   ' };
    expect(formatDisplayName(n)).toBe('Ada Lovelace');
  });

  it('returns empty string when both given and family are missing', () => {
    // Pre-fix this returned the literal "undefined undefined" — see
    // the comment in `formatDisplayName` for the template-literal
    // footgun this guards against.
    const n: PersonName = {} as PersonName;
    expect(formatDisplayName(n)).toBe('');
  });

  it('returns empty string when both given and family are empty/whitespace', () => {
    const n: PersonName = { given: '', family: '   ' };
    expect(formatDisplayName(n)).toBe('');
  });

  it('keeps just the populated half when only one of given/family is set', () => {
    expect(formatDisplayName({ given: 'Sadman', family: '' })).toBe('Sadman');
    expect(formatDisplayName({ given: '', family: 'Chowdhury' })).toBe('Chowdhury');
  });
});
