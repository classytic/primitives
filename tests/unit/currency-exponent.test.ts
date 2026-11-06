import { describe, expect, it } from 'vitest';
import {
  currencyExponent,
  isKnownCurrency,
  MINOR_UNIT_FACTOR,
  UnknownCurrencyError,
} from '../../src/money/currency.js';

describe('currencyExponent — the ISO 4217 minor-unit exponent, never assumed', () => {
  it('reads 0 / 2 / 3 / 4 from the one minor-unit table', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
    expect(currencyExponent('BDT')).toBe(2);
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('BHD')).toBe(3);
    expect(currencyExponent('CLF')).toBe(4);
  });

  it('agrees with MINOR_UNIT_FACTOR for every listed code', () => {
    for (const [code, factor] of Object.entries(MINOR_UNIT_FACTOR)) {
      expect(10 ** currencyExponent(code), code).toBe(factor);
    }
  });

  it('knows ordinary two-decimal ISO codes the old table omitted', () => {
    for (const code of ['SEK', 'NOK', 'EGP', 'NZD', 'ZAR', 'BRL', 'MXN', 'KES']) {
      expect(currencyExponent(code), code).toBe(2);
      expect(isKnownCurrency(code), code).toBe(true);
    }
  });

  it('throws UnknownCurrencyError for a code that is not ISO 4217', () => {
    for (const code of ['ZZZ', 'jpy', '', 'BTD']) {
      expect(() => currencyExponent(code)).toThrow(UnknownCurrencyError);
    }
    expect(() => currencyExponent('ZZZ')).toThrow(/unknown currency/i);
  });
});
