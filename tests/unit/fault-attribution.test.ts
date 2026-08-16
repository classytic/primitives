/**
 * Fault attribution — the rules that decide who pays.
 *
 * Written against the defect that motivated the primitive: `@classytic/order`
 * stored `merchantPaysReturnShipping` as a BOOLEAN defaulting to `false`, so a
 * `damaged_in_transit` return billed the customer. A boolean cannot tell
 * "customer is responsible" from "nobody decided", which is why `unknown` is a
 * real member here and is asserted throughout.
 */
import { describe, it, expect } from 'vitest';
import {
  attributeFault,
  bearsCost,
  needsFaultReview,
  type FaultParty,
} from '../../src/composition/fault-attribution.js';

const RETURN_FAULT = {
  defective: 'merchant',
  damaged_in_transit: 'merchant',
  wrong_item_shipped: 'merchant',
  changed_mind: 'customer',
  wrong_size: 'customer',
  late_delivery: 'carrier',
} as const satisfies Record<string, FaultParty>;

describe('attributeFault', () => {
  it('maps a merchant-fault reason to the merchant', () => {
    expect(attributeFault(RETURN_FAULT, ['damaged_in_transit'])).toBe('merchant');
  });

  it('maps a customer-fault reason to the customer', () => {
    expect(attributeFault(RETURN_FAULT, ['changed_mind'])).toBe('customer');
  });

  it('returns UNKNOWN for an unmapped reason — never a default party', () => {
    // The defect this primitive exists to prevent: `?? false` silently made
    // every unrecognised reason the customer's problem.
    expect(attributeFault(RETURN_FAULT, ['act_of_god' as never])).toBe('unknown');
  });

  it('returns UNKNOWN when there are no reasons at all', () => {
    expect(attributeFault(RETURN_FAULT, [])).toBe('unknown');
  });

  it('is STICKY: one merchant-fault line attributes the whole claim', () => {
    // A customer returning three items, one defective, is not asked to
    // part-pay the shipping.
    expect(attributeFault(RETURN_FAULT, ['changed_mind', 'defective', 'wrong_size'])).toBe('merchant');
  });

  it('prefers carrier over customer', () => {
    expect(attributeFault(RETURN_FAULT, ['changed_mind', 'late_delivery'])).toBe('carrier');
  });

  it('requires agreement otherwise — a mixed pair is UNKNOWN, not a guess', () => {
    expect(attributeFault(RETURN_FAULT, ['changed_mind', 'unmapped' as never])).toBe('unknown');
  });

  it('an EXPLICIT decision always wins, in both directions', () => {
    // A general default must never override a specific instruction.
    expect(attributeFault(RETURN_FAULT, ['damaged_in_transit'], 'customer')).toBe('customer');
    expect(attributeFault(RETURN_FAULT, ['changed_mind'], 'merchant')).toBe('merchant');
    expect(attributeFault(RETURN_FAULT, [], 'shared')).toBe('shared');
  });
});

describe('bearsCost', () => {
  it('charges the attributed party', () => {
    expect(bearsCost('merchant', 'merchant')).toBe(true);
    expect(bearsCost('merchant', 'customer')).toBe(false);
  });

  it('SHARED bears it for every named party', () => {
    expect(bearsCost('shared', 'merchant')).toBe(true);
    expect(bearsCost('shared', 'customer')).toBe(true);
  });

  it('UNKNOWN charges nobody — an undecided claim must not auto-bill', () => {
    expect(bearsCost('unknown', 'merchant')).toBe(false);
    expect(bearsCost('unknown', 'customer')).toBe(false);
  });
});

describe('needsFaultReview', () => {
  it('flags exactly the undecided case', () => {
    expect(needsFaultReview('unknown')).toBe(true);
    for (const p of ['merchant', 'customer', 'carrier', 'shared'] as const) {
      expect(needsFaultReview(p)).toBe(false);
    }
  });
});
