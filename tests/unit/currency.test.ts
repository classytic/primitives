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
} from '../../src/money/currency.js';
import { money } from '../../src/money/money.js';

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

  it('convertWithSnapshot applies the rate to a Money amount', () => {
    // 10 USD (1000 cents) at 110 → 1100 BDT (110 000 paisa).
    expect(convertWithSnapshot(money(1000, 'USD'), usdBdt)).toEqual({
      amount: 110_000,
      currency: 'BDT',
    });
    expect(convertWithSnapshot(money(0, 'USD'), usdBdt)).toEqual({ amount: 0, currency: 'BDT' });
    expect(convertWithSnapshot(money(150, 'USD'), usdBdt)).toEqual({
      amount: 16_500,
      currency: 'BDT',
    });
  });

  it('reverseWithSnapshot inverts (round-trip on exact rates)', () => {
    const base = convertWithSnapshot(money(1000, 'USD'), usdBdt);
    expect(reverseWithSnapshot(base, usdBdt)).toEqual({ amount: 1000, currency: 'USD' });
  });

  it('reverseWithSnapshot throws on zero rate', () => {
    const bad: FxSnapshot = { ...usdBdt, rate: 0 };
    expect(() => reverseWithSnapshot(money(100, 'BDT'), bad)).toThrow();
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

describe('convertWithSnapshot is exact (BigInt, rounded once)', () => {
  type Mode = 'half-away-from-zero' | 'floor' | 'ceil';

  /** Independent reference: the rate as a decimal STRING, so no float touches it. */
  function reference(amount: number, rate: string, from: number, to: number, mode: Mode): number {
    const [whole, fraction = ''] = rate.split('.');
    const num = BigInt(amount) * BigInt(`${whole}${fraction}`) * BigInt(to);
    const den = BigInt(from) * 10n ** BigInt(fraction.length);
    const q = num / den;
    const r = num % den;
    if (r === 0n) return Number(q);
    if (mode === 'floor') return Number(num < 0n ? q - 1n : q);
    if (mode === 'ceil') return Number(num < 0n ? q : q + 1n);
    const away = (r < 0n ? -r : r) * 2n >= den;
    return Number(away ? (num < 0n ? q - 1n : q + 1n) : q);
  }

  const snap = (sourceCurrency: string, baseCurrency: string, rate: number): FxSnapshot => ({
    sourceCurrency,
    baseCurrency,
    rate,
    snapshotAt: new Date('2026-10-11T00:00:00Z'),
  });
  const convert = (amount: number, fx: FxSnapshot, rounding?: Mode) =>
    convertWithSnapshot(money(amount, fx.sourceCurrency), fx, { rounding }).amount;

  // How many of 1..99,999 cents a float (minor / 100) × rate × 100 got wrong:
  // proves the sweep below crosses the ties a float version misses.
  const FLOAT_WRONG: Record<string, number> = { '110.15': 134, '117.35': 1455, '122.35': 1379 };

  for (const rate of Object.keys(FLOAT_WRONG)) {
    it(`USD→BDT at ${rate}: 0 mismatches against the BigInt reference over 1..99,999 cents`, () => {
      const fx = snap('USD', 'BDT', Number(rate));
      const mismatches: number[] = [];
      let floatWrong = 0;
      for (let cents = 1; cents <= 99_999; cents++) {
        const expected = reference(cents, rate, 100, 100, 'half-away-from-zero');
        if (convert(cents, fx) !== expected) mismatches.push(cents);
        if (Math.round((cents / 100) * Number(rate) * 100) !== expected) floatWrong++;
      }
      expect(mismatches).toEqual([]);
      expect(floatWrong).toBe(FLOAT_WRONG[rate]);
    });
  }

  it('floor and ceil are exact too, signed, over the same sweep', () => {
    const fx = snap('USD', 'BDT', 110.15);
    const mismatches: string[] = [];
    for (let cents = -99_999; cents <= 99_999; cents += 7) {
      for (const mode of ['floor', 'ceil'] as const) {
        if (convert(cents, fx, mode) !== reference(cents, '110.15', 100, 100, mode)) {
          mismatches.push(`${mode}:${cents}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('lands exact half-way points away from zero (the two named cases)', () => {
    expect(convert(530, snap('USD', 'BDT', 110.15))).toBe(58_380); // 583.795 BDT
    expect(convert(150, snap('USD', 'BDT', 117.35))).toBe(17_603); // 176.025 BDT
  });

  it('an exact integer result is not nudged by floor / ceil', () => {
    const fx = snap('USD', 'BDT', 110.15);
    expect(convert(220, fx, 'ceil')).toBe(24_233); // float: 24233.000000000004 → 24234
    expect(convert(220, fx, 'floor')).toBe(24_233);
  });

  it('JPY (no minor unit) → BDT and BDT → JPY', () => {
    expect(convert(11, snap('JPY', 'BDT', 0.735))).toBe(809); // 8.085 BDT; float 808
    expect(convert(1000, snap('JPY', 'BDT', 0.7835))).toBe(78_350);
    expect(convert(25_000, snap('BDT', 'JPY', 1.37))).toBe(343); // 342.5 JPY
    expect(convert(10_000, snap('BDT', 'JPY', 1.3651))).toBe(137); // 136.51 JPY
  });

  it('3-decimal currencies (KWD, fils)', () => {
    expect(convert(900, snap('USD', 'KWD', 0.3065))).toBe(2759); // 2.7585 KWD; float 2758
    expect(convert(300, snap('KWD', 'BDT', 30.65))).toBe(920); // 9.195 BDT; float 919
    expect(convert(1000, snap('USD', 'KWD', 0.3047))).toBe(3047);
  });

  it('rates with many decimals, and rates that print in exponent form', () => {
    const fx = snap('BDT', 'USD', 0.0091234);
    expect(convert(12_345, fx)).toBe(113); // 1.12628373 USD
    const mismatches: number[] = [];
    for (let paisa = 1; paisa <= 99_999; paisa++) {
      if (convert(paisa, fx) !== reference(paisa, '0.0091234', 100, 100, 'half-away-from-zero')) {
        mismatches.push(paisa);
      }
    }
    expect(mismatches).toEqual([]);
    expect(convert(5_000_000, snap('BDT', 'USD', 5e-7))).toBe(3); // 2.5 cents
    expect(convert(1_000_000_000, snap('BDT', 'USD', 1e-7))).toBe(100);
  });

  it('negative amounts round symmetrically, and never return -0', () => {
    const fx = snap('USD', 'BDT', 110.15);
    expect(convert(-530, fx)).toBe(-58_380);
    expect(convert(-530, fx, 'floor')).toBe(-58_380);
    expect(convert(-530, fx, 'ceil')).toBe(-58_379);
    expect(Object.is(convert(-1, snap('BDT', 'USD', 0.0091234)), 0)).toBe(true);
  });

  it('refuses a non-finite rate and a non-integer amount', () => {
    for (const rate of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => convertWithSnapshot(money(100, 'USD'), snap('USD', 'BDT', rate))).toThrow(
        TypeError,
      );
    }
    const fractional = { ...money(100, 'USD'), amount: 100.5 };
    expect(() => convertWithSnapshot(fractional, snap('USD', 'BDT', 110))).toThrow(TypeError);
  });
});
