/**
 * `CashDestination` — the one vocabulary for "where did the cash land".
 *
 * Closed on purpose: a request body, a domain event, an SDK and a dialog all
 * import THIS, so a chart renumber cannot reach any of them, and a literal
 * code cannot be smuggled through as an intent.
 */
import { describe, expect, it } from 'vitest';
import {
  CASH_DESTINATIONS,
  cashDestinationLabel,
  isCashDestination,
} from '../../src/money/cash-destination.js';

describe('CashDestination', () => {
  it('is exactly the two intents the accounting tier maps', () => {
    expect([...CASH_DESTINATIONS]).toEqual(['cash', 'petty_cash']);
  });

  it('refuses anything that is not an intent — a chart code above all', () => {
    expect(isCashDestination('cash')).toBe(true);
    expect(isCashDestination('petty_cash')).toBe(true);
    expect(isCashDestination('1112')).toBe(false);
    expect(isCashDestination('bank')).toBe(false);
    expect(isCashDestination(undefined)).toBe(false);
  });

  it('labels every intent, and the switch is exhaustive', () => {
    for (const d of CASH_DESTINATIONS) expect(cashDestinationLabel(d)).toMatch(/\S/);
    expect(cashDestinationLabel('cash')).toBe('Bank account');
    expect(cashDestinationLabel('petty_cash')).toBe('Cash in hand');
    expect(() => cashDestinationLabel('1112' as never)).toThrow(/unknown cash destination/);
  });
});
