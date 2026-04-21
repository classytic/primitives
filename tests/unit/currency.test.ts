import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  convertWithSnapshot,
  type FxSnapshot,
  isCurrencyCode,
  isFxSnapshot,
  MINOR_UNIT_FACTOR,
  minorUnitFactor,
  reverseWithSnapshot,
  toCurrencyCode,
} from '../../src/currency.js';

describe('toCurrencyCode', () => {
  it('accepts any 3 uppercase letters', () => {
    expect(toCurrencyCode('USD')).toBe('USD');
    expect(toCurrencyCode('BDT')).toBe('BDT');
    expect(toCurrencyCode('XYZ')).toBe('XYZ');
  });

  it('rejects lowercase / mixed case', () => {
    expect(toCurrencyCode('usd')).toBeNull();
    expect(toCurrencyCode('Usd')).toBeNull();
  });

  it('rejects wrong length', () => {
    expect(toCurrencyCode('US')).toBeNull();
    expect(toCurrencyCode('USDT')).toBeNull();
    expect(toCurrencyCode('')).toBeNull();
  });

  it('rejects digits / symbols', () => {
    expect(toCurrencyCode('US1')).toBeNull();
    expect(toCurrencyCode('U$D')).toBeNull();
  });
});

describe('isCurrencyCode', () => {
  it('narrows unknown input', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode(undefined)).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
    expect(isCurrencyCode(42)).toBe(false);
    expect(isCurrencyCode({})).toBe(false);
  });
});

describe('minorUnitFactor', () => {
  it('returns 100 for 2-decimal currencies', () => {
    expect(minorUnitFactor('USD')).toBe(100);
    expect(minorUnitFactor('EUR')).toBe(100);
    expect(minorUnitFactor('BDT')).toBe(100);
  });

  it('returns 1 for zero-decimal currencies', () => {
    expect(minorUnitFactor('JPY')).toBe(1);
    expect(minorUnitFactor('KRW')).toBe(1);
    expect(minorUnitFactor('VND')).toBe(1);
  });

  it('returns 1000 for three-decimal currencies', () => {
    expect(minorUnitFactor('KWD')).toBe(1000);
    expect(minorUnitFactor('BHD')).toBe(1000);
    expect(minorUnitFactor('JOD')).toBe(1000);
    expect(minorUnitFactor('OMR')).toBe(1000);
    expect(minorUnitFactor('TND')).toBe(1000);
  });

  it('falls back to 100 for unknown codes', () => {
    expect(minorUnitFactor('XYZ')).toBe(100);
    expect(minorUnitFactor('')).toBe(100);
  });
});

describe('FxSnapshot', () => {
  const usdBdt: FxSnapshot = {
    sourceCurrency: 'USD',
    baseCurrency: 'BDT',
    rate: 110,
    snapshotAt: new Date('2026-04-19T00:00:00Z'),
    source: 'bangladesh-bank',
  };

  it('convertWithSnapshot applies the rate', () => {
    expect(convertWithSnapshot(10, usdBdt)).toBe(1100);
    expect(convertWithSnapshot(0, usdBdt)).toBe(0);
    expect(convertWithSnapshot(1.5, usdBdt)).toBe(165);
  });

  it('reverseWithSnapshot inverts (round-trip on exact rates)', () => {
    const base = convertWithSnapshot(10, usdBdt);
    expect(reverseWithSnapshot(base, usdBdt)).toBe(10);
  });

  it('reverseWithSnapshot throws on zero rate', () => {
    const bad: FxSnapshot = { ...usdBdt, rate: 0 };
    expect(() => reverseWithSnapshot(100, bad)).toThrow();
  });

  it('isFxSnapshot accepts well-formed snapshots', () => {
    expect(isFxSnapshot(usdBdt)).toBe(true);
    expect(isFxSnapshot({ ...usdBdt, source: undefined })).toBe(true);
  });

  it('isFxSnapshot rejects missing / malformed fields', () => {
    expect(isFxSnapshot(null)).toBe(false);
    expect(isFxSnapshot(undefined)).toBe(false);
    expect(isFxSnapshot({})).toBe(false);
    expect(isFxSnapshot({ ...usdBdt, rate: 0 })).toBe(false);
    expect(isFxSnapshot({ ...usdBdt, rate: -1 })).toBe(false);
    expect(isFxSnapshot({ ...usdBdt, rate: Number.NaN })).toBe(false);
    expect(isFxSnapshot({ ...usdBdt, rate: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isFxSnapshot({ ...usdBdt, snapshotAt: '2026-04-19' })).toBe(false);
    expect(isFxSnapshot({ ...usdBdt, sourceCurrency: 42 })).toBe(false);
  });
});

describe('CURRENCIES constants', () => {
  it('every value equals its key (codes match)', () => {
    for (const [key, value] of Object.entries(CURRENCIES)) {
      expect(value).toBe(key);
    }
  });

  it('MINOR_UNIT_FACTOR keys are all uppercase 3-letter', () => {
    for (const key of Object.keys(MINOR_UNIT_FACTOR)) {
      expect(key).toMatch(/^[A-Z]{3}$/);
    }
  });
});
