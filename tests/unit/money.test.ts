import { describe, expect, it } from 'vitest';
import {
  absMoney,
  addMoney,
  CurrencyMismatchError,
  compareMoney,
  equalsMoney,
  fromMajor,
  isMoney,
  isNegativeMoney,
  isPositiveMoney,
  isZeroMoney,
  money,
  multiplyMoney,
  negateMoney,
  subtractMoney,
  sumMoney,
  toMajor,
} from '../../src/money.js';
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
