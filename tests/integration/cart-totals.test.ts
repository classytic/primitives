/**
 * Scenario — Money primitives compose into cart-like aggregate math without
 * float drift.
 *
 * The real pain point across order/cart/ledger today: different packages round
 * totals differently and the sum of lines stops matching the grand total under
 * certain inputs. If primitives are correct, that drift disappears.
 */

import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  equalsMoney,
  fromMajor,
  money,
  multiplyMoney,
  subtractMoney,
  sumMoney,
  toMajor,
} from '../../src/money.js';

interface CartLine {
  unitPrice: { amount: number; currency: string };
  quantity: number;
}

function lineTotal(line: CartLine) {
  return multiplyMoney(line.unitPrice, line.quantity);
}

function cartTotal(lines: readonly CartLine[], currency: string) {
  return sumMoney(lines.map(lineTotal), currency);
}

describe('cart totals — sum of lines matches grand total', () => {
  it('two-decimal currency (USD)', () => {
    const lines: CartLine[] = [
      { unitPrice: fromMajor(9.99, 'USD'), quantity: 3 },
      { unitPrice: fromMajor(4.5, 'USD'), quantity: 2 },
      { unitPrice: fromMajor(1.33, 'USD'), quantity: 7 },
    ];
    const total = cartTotal(lines, 'USD');

    // 9.99 × 3 = 29.97 → 2997
    // 4.50 × 2 =  9.00 →  900
    // 1.33 × 7 =  9.31 →  931
    // total = 48.28 → 4828
    expect(total).toEqual({ amount: 4828, currency: 'USD' });
    expect(toMajor(total)).toBe(48.28);
  });

  it('zero-decimal currency (JPY)', () => {
    const lines: CartLine[] = [
      { unitPrice: fromMajor(1500, 'JPY'), quantity: 4 },
      { unitPrice: fromMajor(300, 'JPY'), quantity: 10 },
    ];
    const total = cartTotal(lines, 'JPY');
    expect(total).toEqual({ amount: 9000, currency: 'JPY' });
  });

  it('three-decimal currency (KWD)', () => {
    const lines: CartLine[] = [
      { unitPrice: fromMajor(1.234, 'KWD'), quantity: 2 },
      { unitPrice: fromMajor(0.5, 'KWD'), quantity: 3 },
    ];
    const total = cartTotal(lines, 'KWD');
    expect(total).toEqual({ amount: 3968, currency: 'KWD' });
    expect(toMajor(total)).toBe(3.968);
  });

  it('tax + discount pipeline preserves equality (add/sub inverse)', () => {
    const subtotal = fromMajor(100, 'USD');
    const discount = fromMajor(15, 'USD');
    const tax = multiplyMoney(subtractMoney(subtotal, discount), 0.1);
    const total = addMoney(subtractMoney(subtotal, discount), tax);
    expect(total).toEqual({ amount: 9350, currency: 'USD' });

    // Reversing the math round-trips exactly
    const reconstructedSubtotal = addMoney(subtractMoney(total, tax), discount);
    expect(equalsMoney(reconstructedSubtotal, subtotal)).toBe(true);
  });

  it('compare sorts prices correctly', () => {
    const prices = [
      fromMajor(4.5, 'USD'),
      fromMajor(9.99, 'USD'),
      fromMajor(1.33, 'USD'),
      fromMajor(12.0, 'USD'),
    ];
    const sorted = [...prices].sort(compareMoney);
    expect(sorted.map((p) => p.amount)).toEqual([133, 450, 999, 1200]);
  });

  it('empty cart sums to zero in currency', () => {
    expect(cartTotal([], 'USD')).toEqual({ amount: 0, currency: 'USD' });
  });

  it('does not drift over many small additions (IEEE 754 regression guard)', () => {
    // 100 × 0.01 via addMoney should equal exactly 1.00 USD
    let total = money(0, 'USD');
    for (let i = 0; i < 100; i++) {
      total = addMoney(total, fromMajor(0.01, 'USD'));
    }
    expect(total).toEqual({ amount: 100, currency: 'USD' });
    expect(toMajor(total)).toBe(1);
  });
});
