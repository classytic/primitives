import { describe, expect, it } from 'vitest';
import {
  convertWithSnapshot,
  minorUnitFactor,
  reverseWithSnapshot,
} from '../../src/money/currency.js';
import { fromMajor, money, toMajor } from '../../src/money/money.js';

// The table lists every ISO 4217 code, so an unlisted one is a mistake: it throws, never 100.
describe('minorUnitFactor refuses an unlisted code instead of assuming two decimals', () => {
  it('throws for a code that is not ISO 4217', () => {
    for (const code of ['XYZ', 'ZZZ', 'jpy', '', 'BTD']) {
      expect(() => minorUnitFactor(code)).toThrow(/unknown currency/i);
    }
  });

  it('fromMajor / toMajor throw for a well-formed but unknown code', () => {
    expect(() => fromMajor(12.34, 'XYZ')).toThrow(/unknown currency/i);
    expect(() => toMajor(money(1234, 'XYZ'))).toThrow(/unknown currency/i);
  });

  it('an FX snapshot naming an unknown currency throws on either leg', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    expect(() =>
      convertWithSnapshot(money(100, 'USD'), {
        sourceCurrency: 'USD',
        baseCurrency: 'XYZ',
        rate: 110,
        snapshotAt: at,
      }),
    ).toThrow(/unknown currency/i);
    expect(() =>
      reverseWithSnapshot(money(100, 'XYZ'), {
        sourceCurrency: 'USD',
        baseCurrency: 'XYZ',
        rate: 110,
        snapshotAt: at,
      }),
    ).toThrow(/unknown currency/i);
  });

  it('every listed code still resolves', () => {
    expect(minorUnitFactor('SEK')).toBe(100);
    expect(minorUnitFactor('JPY')).toBe(1);
    expect(minorUnitFactor('KWD')).toBe(1000);
    expect(fromMajor(1500, 'JPY').amount).toBe(1500);
  });
});
