import { describe, expect, it } from 'vitest';
import {
  absMoney,
  addMoney,
  CurrencyMismatchError,
  compareMoney,
  equalsMoney,
  formatMinorUnits,
  fromMajor,
  isMoney,
  majorToMinorUnits,
  minorUnitsToMajor,
  percentOfMinor,
  isNegativeMoney,
  isPositiveMoney,
  isZeroMoney,
  money,
  multiplyMoney,
  negateMoney,
  subtractMoney,
  sumMoney,
  toMajor,
} from '../../src/money/money.js';
import { makeMoney } from '../helpers/fixtures.js';

describe('money() — integer constructor', () => {
  it('accepts finite integer minor units', () => {
    expect(money(1999, 'USD')).toEqual({ amount: 1999, currency: 'USD' });
    expect(money(0, 'USD')).toEqual({ amount: 0, currency: 'USD' });
    expect(money(-500, 'USD')).toEqual({ amount: -500, currency: 'USD' });
  });

  it('rejects non-integer amounts', () => {
    expect(() => money(19.99, 'USD')).toThrow(TypeError);
    expect(() => money(0.5, 'USD')).toThrow(/integer/);
  });

  it('rejects non-finite amounts', () => {
    expect(() => money(Number.NaN, 'USD')).toThrow(TypeError);
    expect(() => money(Number.POSITIVE_INFINITY, 'USD')).toThrow(TypeError);
    expect(() => money(Number.NEGATIVE_INFINITY, 'USD')).toThrow(TypeError);
  });
});

describe('fromMajor — float → integer minor units', () => {
  it('rounds two-decimal currencies', () => {
    expect(fromMajor(19.99, 'USD')).toEqual({ amount: 1999, currency: 'USD' });
    expect(fromMajor(0, 'USD')).toEqual({ amount: 0, currency: 'USD' });
    expect(fromMajor(-19.99, 'USD')).toEqual({ amount: -1999, currency: 'USD' });
  });

  it('handles zero-decimal currencies (JPY)', () => {
    expect(fromMajor(1500, 'JPY')).toEqual({ amount: 1500, currency: 'JPY' });
    expect(fromMajor(1500.4, 'JPY')).toEqual({ amount: 1500, currency: 'JPY' });
    expect(fromMajor(1500.5, 'JPY')).toEqual({ amount: 1501, currency: 'JPY' });
  });

  it('handles three-decimal currencies (KWD/BHD/JOD/OMR/TND)', () => {
    expect(fromMajor(500, 'KWD')).toEqual({ amount: 500_000, currency: 'KWD' });
    expect(fromMajor(1.234, 'BHD')).toEqual({ amount: 1234, currency: 'BHD' });
  });

  it('strips IEEE trailing-bit noise (0.1 + 0.2 case)', () => {
    expect(fromMajor(0.1 + 0.2, 'USD')).toEqual({ amount: 30, currency: 'USD' });
  });

  it('defaults unknown currencies to 2 decimals', () => {
    expect(fromMajor(12.34, 'XYZ')).toEqual({ amount: 1234, currency: 'XYZ' });
  });

  it('rejects non-finite input', () => {
    expect(() => fromMajor(Number.NaN, 'USD')).toThrow(TypeError);
    expect(() => fromMajor(Number.POSITIVE_INFINITY, 'USD')).toThrow(TypeError);
  });
});

describe('toMajor', () => {
  it('round-trips common values', () => {
    expect(toMajor(money(1999, 'USD'))).toBe(19.99);
    expect(toMajor(money(1500, 'JPY'))).toBe(1500);
    expect(toMajor(money(500_000, 'KWD'))).toBe(500);
    expect(toMajor(money(0, 'USD'))).toBe(0);
  });
});

describe('addMoney / subtractMoney', () => {
  it('sums without float drift', () => {
    const a = fromMajor(0.1, 'USD');
    const b = fromMajor(0.2, 'USD');
    expect(addMoney(a, b)).toEqual({ amount: 30, currency: 'USD' });
    expect(toMajor(addMoney(a, b))).toBe(0.3);
  });

  it('subtracts', () => {
    expect(subtractMoney(money(1000, 'USD'), money(300, 'USD'))).toEqual({
      amount: 700,
      currency: 'USD',
    });
  });

  it('throws on currency mismatch', () => {
    expect(() => addMoney(money(100, 'USD'), money(100, 'EUR'))).toThrow(CurrencyMismatchError);
    expect(() => subtractMoney(money(100, 'USD'), money(100, 'BDT'))).toThrow(
      CurrencyMismatchError,
    );
  });

  it('CurrencyMismatchError carries operands', () => {
    try {
      addMoney(money(1, 'USD'), money(1, 'EUR'));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CurrencyMismatchError);
      if (e instanceof CurrencyMismatchError) {
        expect(e.left).toBe('USD');
        expect(e.right).toBe('EUR');
        expect(e.name).toBe('CurrencyMismatchError');
      }
    }
  });
});

describe('multiplyMoney', () => {
  it('multiplies by scalar', () => {
    expect(multiplyMoney(money(1000, 'USD'), 3)).toEqual({ amount: 3000, currency: 'USD' });
  });

  it('rounds half-away-from-zero', () => {
    expect(multiplyMoney(money(100, 'USD'), 0.155)).toEqual({ amount: 16, currency: 'USD' });
    expect(multiplyMoney(money(-100, 'USD'), 0.155)).toEqual({ amount: -16, currency: 'USD' });
  });

  it('rejects non-finite scalar', () => {
    expect(() => multiplyMoney(money(100, 'USD'), Number.NaN)).toThrow(TypeError);
    expect(() => multiplyMoney(money(100, 'USD'), Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('sumMoney', () => {
  it('sums a list', () => {
    const total = sumMoney([money(100, 'USD'), money(200, 'USD'), money(300, 'USD')], 'USD');
    expect(total).toEqual({ amount: 600, currency: 'USD' });
  });

  it('returns zero in currency for empty list', () => {
    expect(sumMoney([], 'USD')).toEqual({ amount: 0, currency: 'USD' });
    expect(sumMoney([], 'JPY')).toEqual({ amount: 0, currency: 'JPY' });
  });

  it('throws on mixed currencies', () => {
    expect(() => sumMoney([money(100, 'USD'), money(100, 'EUR')], 'USD')).toThrow(
      CurrencyMismatchError,
    );
  });
});

describe('compareMoney / equalsMoney', () => {
  it('orders same-currency values', () => {
    expect(compareMoney(money(100, 'USD'), money(200, 'USD'))).toBe(-1);
    expect(compareMoney(money(200, 'USD'), money(100, 'USD'))).toBe(1);
    expect(compareMoney(money(100, 'USD'), money(100, 'USD'))).toBe(0);
  });

  it('throws on currency mismatch in compare', () => {
    expect(() => compareMoney(money(100, 'USD'), money(100, 'EUR'))).toThrow(CurrencyMismatchError);
  });

  it('equalsMoney is false across currencies', () => {
    expect(equalsMoney(money(100, 'USD'), money(100, 'USD'))).toBe(true);
    expect(equalsMoney(money(100, 'USD'), money(100, 'EUR'))).toBe(false);
    expect(equalsMoney(money(100, 'USD'), money(200, 'USD'))).toBe(false);
  });
});

describe('sign predicates + negate / abs', () => {
  it('detects zero/positive/negative', () => {
    expect(isZeroMoney(money(0, 'USD'))).toBe(true);
    expect(isZeroMoney(money(1, 'USD'))).toBe(false);
    expect(isPositiveMoney(money(1, 'USD'))).toBe(true);
    expect(isPositiveMoney(money(0, 'USD'))).toBe(false);
    expect(isNegativeMoney(money(-1, 'USD'))).toBe(true);
    expect(isNegativeMoney(money(0, 'USD'))).toBe(false);
  });

  it('negates', () => {
    expect(negateMoney(money(100, 'USD'))).toEqual({ amount: -100, currency: 'USD' });
    expect(negateMoney(money(-100, 'USD'))).toEqual({ amount: 100, currency: 'USD' });
    expect(negateMoney(money(0, 'USD'))).toEqual({ amount: 0, currency: 'USD' });
  });

  it('abs', () => {
    expect(absMoney(money(-100, 'USD'))).toEqual({ amount: 100, currency: 'USD' });
    expect(absMoney(money(100, 'USD'))).toEqual({ amount: 100, currency: 'USD' });
  });
});

describe('isMoney type guard', () => {
  it('accepts valid Money shape', () => {
    expect(isMoney(makeMoney())).toBe(true);
    expect(isMoney({ amount: 0, currency: 'JPY' })).toBe(true);
  });

  it('rejects non-integer amount', () => {
    expect(isMoney({ amount: 19.99, currency: 'USD' })).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(isMoney({ amount: 100 })).toBe(false);
    expect(isMoney({ currency: 'USD' })).toBe(false);
    expect(isMoney({})).toBe(false);
  });

  it('rejects nullish and primitives', () => {
    expect(isMoney(null)).toBe(false);
    expect(isMoney(undefined)).toBe(false);
    expect(isMoney('USD')).toBe(false);
    expect(isMoney(100)).toBe(false);
  });
});

// ── Scalar minor-unit helpers (ledger-compatible dialect) ───────────────────
//
// These freeze the @classytic/ledger characterization semantics: raw IEEE
// Math.round (half-up toward +∞), NO toPrecision noise-cleaning. The paired
// assertions against fromMajor document the intentional divergence.

describe('majorToMinorUnits — scalar major→minor', () => {
  it('converts with default 2 decimals', () => {
    expect(majorToMinorUnits(10.5)).toBe(1050);
    expect(majorToMinorUnits(0)).toBe(0);
    expect(majorToMinorUnits(100)).toBe(10000);
    expect(majorToMinorUnits(0.01)).toBe(1);
    expect(majorToMinorUnits(99.99)).toBe(9999);
    expect(majorToMinorUnits(-5.25)).toBe(-525);
  });

  it('supports 0- and 3-decimal exponents', () => {
    expect(majorToMinorUnits(1000, 0)).toBe(1000);
    expect(majorToMinorUnits(1.234, 3)).toBe(1234);
  });

  it('keeps raw IEEE Math.round semantics (ledger characterization)', () => {
    // 1.005 * 100 === 100.4999… in IEEE 754 → 100 (fromMajor cleans to 101)
    expect(majorToMinorUnits(1.005)).toBe(100);
    expect(fromMajor(1.005, 'USD').amount).toBe(101);
    // float-trap sum still lands correctly
    expect(majorToMinorUnits(0.1 + 0.2)).toBe(30);
    // Math.round is half-up toward +∞ — exact negative halves round UP
    // (-0.125 is exactly representable; ×100 = -12.5 exactly)
    expect(majorToMinorUnits(-0.125)).toBe(-12);
    expect(fromMajor(-0.125, 'USD').amount).toBe(-13);
  });

  it('throws RangeError beyond the safe-integer range and on non-finite input', () => {
    expect(() => majorToMinorUnits(90_071_992_547_410)).toThrow('exceeds safe integer');
    expect(() => majorToMinorUnits(Number.NaN)).toThrow(RangeError);
    expect(() => majorToMinorUnits(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('minorUnitsToMajor — scalar minor→major', () => {
  it('divides by the exponent factor', () => {
    expect(minorUnitsToMajor(1050)).toBe(10.5);
    expect(minorUnitsToMajor(0)).toBe(0);
    expect(minorUnitsToMajor(1)).toBe(0.01);
    expect(minorUnitsToMajor(1000, 0)).toBe(1000);
  });
});

describe('percentOfMinor — exact multiply-then-round', () => {
  it('computes standard percentages', () => {
    expect(percentOfMinor(10000, 5)).toBe(500);
    expect(percentOfMinor(10000, 13)).toBe(1300);
    expect(percentOfMinor(5000, 100)).toBe(5000);
    expect(percentOfMinor(0, 5)).toBe(0);
    expect(percentOfMinor(-10000, 10)).toBe(-1000);
  });

  it('handles fractional rates exactly (no basis-point snapping)', () => {
    // QST 9.975 % — 20000 × 9.975 / 100 = 1995 exactly; a bps-snapped
    // variant (998 bps) would yield 1996.
    expect(percentOfMinor(20000, 9.975)).toBe(1995);
    expect(percentOfMinor(10000, 9.975)).toBe(998); // 997.5 → half-up
    expect(percentOfMinor(100, 0.01)).toBe(0);
    expect(percentOfMinor(100000, 0.01)).toBe(10);
  });

  it('throws TypeError on non-finite input', () => {
    expect(() => percentOfMinor(Number.NaN, 5)).toThrow(TypeError);
    expect(() => percentOfMinor(100, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('formatMinorUnits — plain decimal string', () => {
  it('formats with default 2 decimals', () => {
    expect(formatMinorUnits(10550)).toBe('105.50');
    expect(formatMinorUnits(0)).toBe('0.00');
    expect(formatMinorUnits(1)).toBe('0.01');
    expect(formatMinorUnits(-5050)).toBe('-50.50');
    expect(formatMinorUnits(1234567890)).toBe('12345678.90');
  });

  it('respects the exponent', () => {
    expect(formatMinorUnits(1000, 0)).toBe('1000');
    expect(formatMinorUnits(1234, 3)).toBe('1.234');
  });
});
