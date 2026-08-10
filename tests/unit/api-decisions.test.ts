/**
 * Regression tests for the API decisions A9–A12.
 *
 * Each `it` here fails against the shape that shipped before the decision was
 * taken — that is the point of the file. The old behaviour it guards against is
 * named in the test title.
 */

import { describe, expect, it } from 'vitest';
import {
  isFundsReceived,
  isPaymentEvent,
  PAYMENT_EVENT_TYPE,
  type PaymentEventPayload,
  type PaymentSucceededPayload,
  type PaymentUnknownPayload,
} from '../../src/events/payment-events.js';
import {
  CurrencyMismatchError,
  convertWithSnapshot,
  currencyCode,
  type FxSnapshot,
  InvalidCurrencyCodeError,
  reverseWithSnapshot,
} from '../../src/money/currency.js';
import { fromMajor, isMoney, money, sumMoney } from '../../src/money/money.js';
import {
  type ApprovalChain,
  ApprovalError,
  applyDecision,
  assertApproved,
  assertApprovedIfPresent,
  createChain,
} from '../../src/workflow/approval.js';

// ─────────────────────────────────────────────────────────────────────────
// A9 — assertApproved must not pass on an absent chain
// ─────────────────────────────────────────────────────────────────────────

const approvedChain = (): ApprovalChain => {
  const chain = createChain({
    order: 'sequential',
    steps: [{ id: 'finance', approvers: [{ id: 'cfo' }] }],
  });
  return applyDecision(chain, { stepId: 'finance', approverId: 'cfo', decision: 'approved' });
};

describe('A9 — assertApproved', () => {
  it('passes an approved chain', () => {
    expect(() => assertApproved(approvedChain())).not.toThrow();
  });

  it('THROWS CHAIN_MISSING on null — the old behaviour PASSED here', () => {
    expect(() => assertApproved(null)).toThrow(ApprovalError);
    try {
      assertApproved(null);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApprovalError).code).toBe('CHAIN_MISSING');
    }
  });

  it('THROWS CHAIN_MISSING on undefined — the mongoose-stripped-field case', () => {
    // A schema that never declared `approvalChain` reads back like this.
    const persisted = JSON.parse(JSON.stringify({ id: 'je_1' })) as {
      approvalChain?: ApprovalChain;
    };
    expect(() => assertApproved(persisted.approvalChain)).toThrow(
      /absent chain is not an approved one/,
    );
  });

  it('still THROWS CHAIN_INCOMPLETE on a pending chain', () => {
    const pending = createChain({
      order: 'sequential',
      steps: [{ id: 's', approvers: [{ id: 'a' }] }],
    });
    try {
      assertApproved(pending);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApprovalError).code).toBe('CHAIN_INCOMPLETE');
    }
  });

  it('distinguishes MISSING from INCOMPLETE — two different operator problems', () => {
    const codes = [
      null,
      createChain({ order: 'sequential', steps: [{ id: 's', approvers: [{ id: 'a' }] }] }),
    ].map((chain) => {
      try {
        assertApproved(chain);
        return 'passed';
      } catch (err) {
        return (err as ApprovalError).code;
      }
    });
    expect(codes).toEqual(['CHAIN_MISSING', 'CHAIN_INCOMPLETE']);
  });

  it('honours an override message', () => {
    expect(() => assertApproved(null, { message: 'PO must be approved before receipt' })).toThrow(
      'PO must be approved before receipt',
    );
  });

  it('assertApprovedIfPresent is the EXPLICIT opt-out, and still enforces a present chain', () => {
    expect(() => assertApprovedIfPresent(null)).not.toThrow();
    expect(() => assertApprovedIfPresent(undefined)).not.toThrow();
    expect(() => assertApprovedIfPresent(approvedChain())).not.toThrow();
    const pending = createChain({
      order: 'sequential',
      steps: [{ id: 's', approvers: [{ id: 'a' }] }],
    });
    expect(() => assertApprovedIfPresent(pending)).toThrow(ApprovalError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// A10 — payment event discriminant + the unknown outcome
// ─────────────────────────────────────────────────────────────────────────

const succeeded: PaymentSucceededPayload = {
  eventType: PAYMENT_EVENT_TYPE.SUCCEEDED,
  paymentId: 'pay_1',
  providerCode: 'stripe',
  amount: money(4999, 'BDT'),
  methodKind: 'card',
  occurredAt: new Date('2026-08-05T10:00:00Z'),
};

const initiated: PaymentEventPayload = {
  eventType: PAYMENT_EVENT_TYPE.INITIATED,
  paymentId: 'pay_1',
  providerCode: 'stripe',
  amount: money(4999, 'BDT'),
  methodKind: 'card',
  occurredAt: new Date('2026-08-05T09:59:00Z'),
};

describe('A10 — payment events', () => {
  it('initiated and succeeded are DISTINGUISHABLE — they used to be structurally identical', () => {
    // Same fields, same values, different meaning. Only the discriminant separates them.
    const { eventType: _a, ...initiatedBody } = initiated as PaymentSucceededPayload;
    const { eventType: _b, ...succeededBody } = succeeded;
    expect(Object.keys(initiatedBody).sort()).toEqual(Object.keys(succeededBody).sort());
    expect(initiated.eventType).not.toBe(succeeded.eventType);
  });

  it('isPaymentEvent narrows — a "funds received" handler REFUSES money in flight', () => {
    expect(isPaymentEvent(PAYMENT_EVENT_TYPE.SUCCEEDED, succeeded)).toBe(true);
    expect(isPaymentEvent(PAYMENT_EVENT_TYPE.SUCCEEDED, initiated)).toBe(false);
  });

  it('isFundsReceived accepts succeeded + captured only', () => {
    expect(isFundsReceived(succeeded)).toBe(true);
    expect(isFundsReceived(initiated)).toBe(false);
  });

  it('there IS an event for the unknown outcome — the port contract’s third value', () => {
    expect(PAYMENT_EVENT_TYPE.UNKNOWN).toBe('payment.unknown');
    const unknown: PaymentUnknownPayload = {
      eventType: PAYMENT_EVENT_TYPE.UNKNOWN,
      paymentId: 'pay_1',
      providerCode: 'bkash',
      operation: 'capture',
      causeCode: 'timeout',
      occurredAt: new Date(),
    };
    expect(isPaymentEvent(PAYMENT_EVENT_TYPE.UNKNOWN, unknown)).toBe(true);
    // An unobserved outcome is NEITHER of the two terminal ones.
    expect(isFundsReceived(unknown)).toBe(false);
    expect(isPaymentEvent(PAYMENT_EVENT_TYPE.FAILED, unknown)).toBe(false);
  });

  it('every declared event type is reachable as a discriminant value', () => {
    const values = Object.values(PAYMENT_EVENT_TYPE);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain('payment.unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// A11 — the FX seam enforces its own precondition
// ─────────────────────────────────────────────────────────────────────────

const usdBdt: FxSnapshot = {
  sourceCurrency: 'USD',
  baseCurrency: 'BDT',
  rate: 110,
  snapshotAt: new Date('2026-04-19T00:00:00Z'),
};

describe('A11 — convertWithSnapshot takes Money', () => {
  it('converts a source-currency amount', () => {
    expect(convertWithSnapshot(money(1000, 'USD'), usdBdt)).toEqual({
      amount: 110_000,
      currency: 'BDT',
    });
  });

  it('THROWS when the amount is not in fx.sourceCurrency — the bare-number form returned a plausible wrong number', () => {
    expect(() => convertWithSnapshot(money(1000, 'EUR'), usdBdt)).toThrow(CurrencyMismatchError);
  });

  it('THROWS symmetrically on the reverse direction', () => {
    expect(() => reverseWithSnapshot(money(110_000, 'EUR'), usdBdt)).toThrow(CurrencyMismatchError);
    expect(() => reverseWithSnapshot(money(110_000, 'BDT'), usdBdt)).not.toThrow();
  });

  it('respects differing minor-unit exponents (USD 2 → JPY 0)', () => {
    const usdJpy: FxSnapshot = {
      sourceCurrency: 'USD',
      baseCurrency: 'JPY',
      rate: 150,
      snapshotAt: new Date(),
    };
    // 10 USD = 1000 cents; ×150 = 1500 JPY = 1500 minor units (JPY has no minor unit).
    expect(convertWithSnapshot(money(1000, 'USD'), usdJpy)).toEqual({
      amount: 1500,
      currency: 'JPY',
    });
  });

  it('rounds deterministically, and the mode is selectable', () => {
    const odd: FxSnapshot = {
      sourceCurrency: 'USD',
      baseCurrency: 'BDT',
      rate: 110.005,
      snapshotAt: new Date(),
    };
    const half = convertWithSnapshot(money(100, 'USD'), odd);
    const floor = convertWithSnapshot(money(100, 'USD'), odd, { rounding: 'floor' });
    const ceil = convertWithSnapshot(money(100, 'USD'), odd, { rounding: 'ceil' });
    expect(floor.amount).toBeLessThanOrEqual(half.amount);
    expect(ceil.amount).toBeGreaterThanOrEqual(half.amount);
    expect(Number.isInteger(half.amount)).toBe(true);
  });

  it('returns Money, so the result cannot be fed back in as a source amount by accident', () => {
    const bdt = convertWithSnapshot(money(1000, 'USD'), usdBdt);
    expect(() => convertWithSnapshot(bdt, usdBdt)).toThrow(CurrencyMismatchError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// A12 — Money.currency is validated and branded
// ─────────────────────────────────────────────────────────────────────────

describe('A12 — Money.currency', () => {
  it('money() REJECTS a lowercase code — it misses the minor-unit table by 100×', () => {
    expect(() => money(1500, 'jpy')).toThrow(InvalidCurrencyCodeError);
  });

  it('money() rejects empty / malformed codes that used to sail through', () => {
    for (const bad of ['', 'US', 'USDD', 'US Dollar', '123']) {
      expect(() => money(1, bad)).toThrow(InvalidCurrencyCodeError);
    }
  });

  it('fromMajor and sumMoney validate on the same path', () => {
    expect(() => fromMajor(19.99, 'usd')).toThrow(InvalidCurrencyCodeError);
    expect(() => sumMoney([], 'usd')).toThrow(InvalidCurrencyCodeError);
    expect(sumMoney([], 'USD')).toEqual({ amount: 0, currency: 'USD' });
  });

  it('accepts any well-formed ISO 4217 code, including ones absent from the exponent table', () => {
    expect(money(1, 'XYZ')).toEqual({ amount: 1, currency: 'XYZ' });
  });

  it('isMoney rejects a blank currency — the shape a stripped field arrives in', () => {
    expect(isMoney({ amount: 1, currency: 'BDT' })).toBe(true);
    expect(isMoney({ amount: 1, currency: '' })).toBe(false);
    expect(isMoney({ amount: 1, currency: 'bdt' })).toBe(false);
  });

  it('currencyCode is the boundary constructor', () => {
    expect(currencyCode('BDT')).toBe('BDT');
    expect(() => currencyCode('bdt')).toThrow(InvalidCurrencyCodeError);
  });

  it('CurrencyMismatchError is still importable from /money', async () => {
    const mod = await import('../../src/money/money.js');
    expect(mod.CurrencyMismatchError).toBe(CurrencyMismatchError);
  });
});
