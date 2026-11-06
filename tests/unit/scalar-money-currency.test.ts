import { describe, expect, it } from 'vitest';
import { formatMinorUnits, majorToMinorUnits, minorUnitsToMajor } from '../../src/money/money.js';

// The scalar helpers take the CURRENCY and read its ISO 4217 exponent; no default exponent exists.
const CASES = [
  { currency: 'JPY', major: 1500, minor: 1500, text: '1500' },
  { currency: 'BDT', major: 1234.56, minor: 123456, text: '1234.56' },
  { currency: 'USD', major: 10.5, minor: 1050, text: '10.50' },
  { currency: 'KWD', major: 1.234, minor: 1234, text: '1.234' },
  { currency: 'CLF', major: 2.5, minor: 25000, text: '2.5000' },
] as const;

describe('scalar minor-unit helpers read the currency exponent', () => {
  for (const c of CASES) {
    it(`${c.currency}: major -> minor -> major round-trips`, () => {
      expect(majorToMinorUnits(c.major, c.currency)).toBe(c.minor);
      expect(minorUnitsToMajor(c.minor, c.currency)).toBe(c.major);
      expect(minorUnitsToMajor(majorToMinorUnits(c.major, c.currency), c.currency)).toBe(c.major);
    });

    it(`${c.currency}: formats at its own exponent`, () => {
      expect(formatMinorUnits(c.minor, c.currency)).toBe(c.text);
      expect(formatMinorUnits(-c.minor, c.currency)).toBe(`-${c.text}`);
    });
  }

  it('a zero-decimal amount is never divided by 100', () => {
    expect(minorUnitsToMajor(1000, 'JPY')).toBe(1000);
    expect(formatMinorUnits(1000, 'JPY')).toBe('1000');
  });

  it('a three-decimal amount keeps its third digit', () => {
    expect(majorToMinorUnits(0.005, 'KWD')).toBe(5);
    expect(formatMinorUnits(5, 'KWD')).toBe('0.005');
  });

  it('the safe-integer guard scales with the exponent', () => {
    expect(() => majorToMinorUnits(9_007_199_254_741, 'KWD')).toThrow('exceeds safe integer');
    expect(majorToMinorUnits(9_007_199_254_740_991, 'JPY')).toBe(9_007_199_254_740_991);
  });

  it('an unknown currency throws instead of assuming two decimals', () => {
    for (const code of ['ZZZ', 'jpy', '', 'US Dollar']) {
      expect(() => majorToMinorUnits(10, code)).toThrow(/unknown currency/i);
      expect(() => minorUnitsToMajor(10, code)).toThrow(/unknown currency/i);
      expect(() => formatMinorUnits(10, code)).toThrow(/unknown currency/i);
    }
  });

  it('a call with no currency throws at runtime too (and is a compile error)', () => {
    // @ts-expect-error the currency is required
    expect(() => majorToMinorUnits(10)).toThrow(/unknown currency/i);
    // @ts-expect-error the currency is required
    expect(() => minorUnitsToMajor(10)).toThrow(/unknown currency/i);
    // @ts-expect-error the currency is required
    expect(() => formatMinorUnits(10)).toThrow(/unknown currency/i);
  });
});
